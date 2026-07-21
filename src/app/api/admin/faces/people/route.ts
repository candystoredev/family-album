import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureFacesSchema } from "@/lib/schema";

/**
 * The named-faces roster: every person who has confirmed faces, with those
 * faces, so a mis-named one can be found and corrected later — not just via an
 * undo in the seconds after naming. This is what keeps a wrong name from being
 * permanently baked into a person's reference centroid.
 *
 * Returns display info only (crop box over the same-origin thumbnail proxy) —
 * descriptors never leave the server.
 *
 * Admin-gated by middleware.
 */

// Cap the roster; a family album won't approach this, but an unbounded query
// behind a UI that renders every tile is a bad default.
const MAX_FACES = 600;

export async function GET() {
  await ensureFacesSchema();

  const res = await db.execute({
    sql: `SELECT mf.id, mf.media_id, mf.post_id, mf.bbox_x, mf.bbox_y, mf.bbox_w, mf.bbox_h,
                 p.id AS person_id, p.name AS person_name
          FROM media_faces mf
          JOIN people p ON p.id = mf.person_id
          WHERE mf.person_id IS NOT NULL
          ORDER BY p.name ASC, mf.created_at DESC
          LIMIT ?`,
    args: [MAX_FACES],
  });

  const byPerson = new Map<
    string,
    { personId: string; name: string; faces: Record<string, unknown>[] }
  >();
  for (const row of res.rows) {
    const personId = row.person_id as string;
    let entry = byPerson.get(personId);
    if (!entry) {
      entry = { personId, name: row.person_name as string, faces: [] };
      byPerson.set(personId, entry);
    }
    entry.faces.push({
      id: row.id as string,
      mediaId: row.media_id as string,
      postId: row.post_id as string,
      box: {
        x: row.bbox_x as number,
        y: row.bbox_y as number,
        w: row.bbox_w as number,
        h: row.bbox_h as number,
      },
      imageUrl: `/api/admin/faces/image/${row.media_id as string}`,
    });
  }

  // Most-photographed first — the people whose references matter most.
  const people = [...byPerson.values()].sort((a, b) => b.faces.length - a.faces.length);

  return NextResponse.json({ people });
}
