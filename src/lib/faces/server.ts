import { db } from "@/lib/db";
import { bytesToDescriptor } from "./descriptor";
import { centroid } from "./cluster";
import type { FaceVector, PersonReference } from "./types";

/**
 * Server-side face helpers: read confirmed faces into per-person reference
 * centroids (the closed-vocabulary "known people" set that new photos match
 * against) and load the unnamed backlog for clustering. Kept out of the pure
 * `cluster.ts` so that stays DB-free and unit-testable.
 */

/** A stored face row, with its descriptor decoded from the BLOB. */
export interface StoredFace {
  id: string;
  mediaId: string;
  postId: string;
  box: { x: number; y: number; w: number; h: number };
  descriptor: number[];
}

function rowToStoredFace(row: Record<string, unknown>): StoredFace {
  return {
    id: row.id as string,
    mediaId: row.media_id as string,
    postId: row.post_id as string,
    box: {
      x: row.bbox_x as number,
      y: row.bbox_y as number,
      w: row.bbox_w as number,
      h: row.bbox_h as number,
    },
    descriptor: bytesToDescriptor(row.descriptor as unknown as Uint8Array),
  };
}

/**
 * Build one reference vector per named person: the centroid of all faces a human
 * has confirmed as that person. People with no confirmed faces yet contribute no
 * reference (nothing to match against). This is the set the compose-time
 * matcher and the cluster suggestions compare new faces to.
 */
export async function loadPersonReferences(): Promise<PersonReference[]> {
  const res = await db.execute(`
    SELECT mf.person_id AS person_id, p.name AS name, mf.descriptor AS descriptor
    FROM media_faces mf
    JOIN people p ON p.id = mf.person_id
    WHERE mf.person_id IS NOT NULL
  `);

  const byPerson = new Map<string, { name: string; descriptors: number[][] }>();
  for (const row of res.rows) {
    const personId = row.person_id as string;
    const entry = byPerson.get(personId);
    const descriptor = bytesToDescriptor(row.descriptor as unknown as Uint8Array);
    if (entry) entry.descriptors.push(descriptor);
    else byPerson.set(personId, { name: row.name as string, descriptors: [descriptor] });
  }

  const refs: PersonReference[] = [];
  for (const [personId, { name, descriptors }] of byPerson) {
    refs.push({ personId, name, centroid: centroid(descriptors), count: descriptors.length });
  }
  return refs;
}

/** Load unnamed faces (person_id IS NULL) for clustering, newest media first. */
export async function loadUnnamedFaces(limit: number): Promise<StoredFace[]> {
  const res = await db.execute({
    sql: `SELECT id, media_id, post_id, bbox_x, bbox_y, bbox_w, bbox_h, descriptor
          FROM media_faces
          WHERE person_id IS NULL
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [limit],
  });
  return res.rows.map((r) => rowToStoredFace(r as Record<string, unknown>));
}

/** Faces as clustering wants them — id + descriptor only. */
export function toFaceVectors(faces: StoredFace[]): FaceVector[] {
  return faces.map((f) => ({ id: f.id, descriptor: f.descriptor }));
}
