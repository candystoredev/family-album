import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureFacesSchema, rebuildFtsIndex } from "@/lib/schema";

/**
 * Un-name faces — the correction path for a mis-named cluster.
 *
 * Naming is the one irreversible-feeling step in the pipeline: a wrong name
 * doesn't just mis-tag a post (fixable by editing the post), it folds that
 * face's descriptor into the person's reference centroid, degrading every
 * future match for them. This route undoes both halves:
 *
 *   1. the faces go back to unnamed/auto, so they leave that person's centroid
 *      and return to the clustering pool to be named correctly, and
 *   2. the person is untagged from a post ONLY when they have no remaining
 *      named face in it — and only when the junction row is `source='auto'`
 *      (i.e. this feature added it). A hand-curated `'human'` tag is never
 *      removed by un-naming a face.
 *
 * Admin-gated by middleware.
 */

export async function POST(request: NextRequest) {
  let body: { faceIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const faceIds = Array.isArray(body.faceIds)
    ? body.faceIds.filter((id): id is string => typeof id === "string")
    : [];
  if (faceIds.length === 0) {
    return NextResponse.json({ error: "faceIds[] required" }, { status: 400 });
  }

  await ensureFacesSchema();

  // Only faces that are actually named can be un-named. Capture their
  // (person, post) pairs before the update so we know what to re-check after.
  const placeholders = faceIds.map(() => "?").join(",");
  const named = await db.execute({
    sql: `SELECT id, person_id, post_id FROM media_faces
          WHERE id IN (${placeholders}) AND person_id IS NOT NULL`,
    args: faceIds,
  });
  if (named.rows.length === 0) {
    return NextResponse.json({ unnamed: 0, untaggedPosts: 0 });
  }

  const ids = named.rows.map((r) => r.id as string);
  const pairs = [
    ...new Map(
      named.rows.map((r) => [
        `${r.person_id as string}|${r.post_id as string}`,
        { personId: r.person_id as string, postId: r.post_id as string },
      ])
    ).values(),
  ];

  // Back to unnamed + 'auto': the face re-enters clustering and stops
  // contributing to that person's reference centroid.
  const idPlaceholders = ids.map(() => "?").join(",");
  await db.execute({
    sql: `UPDATE media_faces SET person_id = NULL, source = 'auto' WHERE id IN (${idPlaceholders})`,
    args: ids,
  });

  // Drop the post tag only where this person no longer has ANY named face in
  // that post, and only if the tag came from this feature ('auto').
  let untaggedPosts = 0;
  for (const { personId, postId } of pairs) {
    const remaining = await db.execute({
      sql: `SELECT 1 FROM media_faces WHERE post_id = ? AND person_id = ? LIMIT 1`,
      args: [postId, personId],
    });
    if (remaining.rows.length > 0) continue;
    const res = await db.execute({
      sql: `DELETE FROM post_people WHERE post_id = ? AND person_id = ? AND source = 'auto'`,
      args: [postId, personId],
    });
    if ((res.rowsAffected ?? 0) > 0) untaggedPosts++;
  }

  // Keep search in step with the tags we just removed.
  if (untaggedPosts > 0) await rebuildFtsIndex();

  return NextResponse.json({ unnamed: ids.length, untaggedPosts });
}
