import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { ensureFacesSchema, rebuildFtsIndex } from "@/lib/schema";
import { slugify } from "@/lib/slugify";

/**
 * Name a face cluster — the one human decision in the whole pipeline. Given a
 * set of face ids and either an existing personId or a new person name, we:
 *   1. narrow to the faces that are actually still unnamed,
 *   2. resolve/create the person (closed-vocabulary: prefer an existing match),
 *   3. set person_id on those faces (turning them into references), and
 *   4. add that person to the posts THOSE faces belong to, marked source='auto'
 *      so face-derived tags stay distinguishable from hand-curated ones (and
 *      never downgrade an existing 'human' tag — INSERT OR IGNORE on the PK).
 * Then the FTS index is rebuilt so the newly-tagged posts are searchable.
 *
 * Every write is derived from the still-unnamed subset, never from the raw
 * faceIds. Otherwise a stale review page (or two tabs naming the same cluster)
 * would tag posts with a person who ends up owning none of their faces, and
 * could mint a brand-new person row that has no confirmed faces at all.
 *
 * Admin-gated by middleware.
 */

export async function POST(request: NextRequest) {
  let body: { faceIds?: unknown; personName?: unknown; personId?: unknown };
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

  const personIdIn = typeof body.personId === "string" ? body.personId.trim() : "";
  const personName = typeof body.personName === "string" ? body.personName.trim() : "";
  if (!personIdIn && !personName) {
    return NextResponse.json({ error: "personId or personName required" }, { status: 400 });
  }
  // A name that slugifies to nothing (emoji/punctuation only) would collide with
  // every other such name on the UNIQUE slug — reject rather than merge them.
  if (!personIdIn && !slugify(personName)) {
    return NextResponse.json({ error: "Name must contain letters or numbers" }, { status: 400 });
  }

  await ensureFacesSchema();

  // Narrow to the faces still unnamed. Everything below is derived from these,
  // so a stale/duplicate naming is a no-op instead of a spurious post tag.
  const placeholders = faceIds.map(() => "?").join(",");
  const pending = await db.execute({
    sql: `SELECT id, post_id FROM media_faces WHERE id IN (${placeholders}) AND person_id IS NULL`,
    args: faceIds,
  });
  const pendingIds = pending.rows.map((r) => r.id as string);
  const postIds = [...new Set(pending.rows.map((r) => r.post_id as string))];

  if (pendingIds.length === 0) {
    // Already named (or deleted) by someone else — don't create a person, don't
    // tag any post, don't rebuild FTS.
    return NextResponse.json({ personId: null, name: null, namedFaces: 0, taggedPosts: 0 });
  }

  // Resolve the person id — verify an existing id, or find-or-create by slug.
  let personId: string;
  let name: string;
  if (personIdIn) {
    const res = await db.execute({ sql: `SELECT id, name FROM people WHERE id = ?`, args: [personIdIn] });
    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Unknown person" }, { status: 404 });
    }
    personId = res.rows[0].id as string;
    name = res.rows[0].name as string;
  } else {
    const slug = slugify(personName);
    await db.execute({
      sql: `INSERT OR IGNORE INTO people (id, name, slug) VALUES (?, ?, ?)`,
      args: [nanoid(), personName, slug],
    });
    const res = await db.execute({ sql: `SELECT id, name FROM people WHERE slug = ?`, args: [slug] });
    personId = res.rows[0].id as string;
    name = res.rows[0].name as string;
  }

  const pendingPlaceholders = pendingIds.map(() => "?").join(",");
  await db.batch(
    [
      {
        sql: `UPDATE media_faces SET person_id = ?, source = 'human' WHERE id IN (${pendingPlaceholders})`,
        args: [personId, ...pendingIds],
      },
      ...postIds.map((postId) => ({
        sql: `INSERT OR IGNORE INTO post_people (post_id, person_id, source) VALUES (?, ?, 'auto')`,
        args: [postId, personId],
      })),
    ],
    "write"
  );

  // Rebuild FTS so the person's name is searchable on the newly-tagged posts.
  // Naming is infrequent and admin-only, so a full rebuild is fine here.
  await rebuildFtsIndex();

  return NextResponse.json({
    personId,
    name,
    namedFaces: pendingIds.length,
    taggedPosts: postIds.length,
  });
}
