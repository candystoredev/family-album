import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { ensureFacesSchema } from "@/lib/schema";
import { descriptorToBytes, DESCRIPTOR_LENGTH } from "@/lib/faces/descriptor";
import type { DetectedFace } from "@/lib/faces/types";

/**
 * Archive face scanner. GET hands the client a page of not-yet-scanned photos
 * (as same-origin proxy URLs); the client runs in-browser detection on each and
 * POSTs the results back. We store one `media_faces` row per detected face
 * (unnamed — person_id stays NULL until a human names the cluster) and stamp
 * `media.faces_scanned_at` so the photo leaves the queue even when zero faces
 * were found. Idempotent per photo: a re-scan replaces that photo's auto faces.
 *
 * Admin-gated by middleware.
 */

const MAX_PAGE = 50;
const MAX_FACES_PER_IMAGE = 40;

export async function GET(request: NextRequest) {
  await ensureFacesSchema();
  const limit = Math.min(
    Math.max(Number(new URL(request.url).searchParams.get("limit")) || 12, 1),
    MAX_PAGE
  );

  const [queue, remaining] = await Promise.all([
    db.execute({
      sql: `SELECT id FROM media
            WHERE type = 'photo' AND faces_scanned_at IS NULL
            ORDER BY rowid ASC
            LIMIT ?`,
      args: [limit],
    }),
    db.execute(`SELECT COUNT(*) AS n FROM media WHERE type = 'photo' AND faces_scanned_at IS NULL`),
  ]);

  return NextResponse.json({
    items: queue.rows.map((r) => ({
      mediaId: r.id as string,
      imageUrl: `/api/admin/faces/image/${r.id as string}`,
    })),
    remaining: Number(remaining.rows[0]?.n ?? 0),
  });
}

interface ScanResult {
  mediaId: string;
  faces: DetectedFace[];
}

function isValidFace(f: unknown): f is DetectedFace {
  if (!f || typeof f !== "object") return false;
  const face = f as Record<string, unknown>;
  const box = face.box as Record<string, unknown> | undefined;
  // Number.isFinite (not typeof) — a NaN slipping into a descriptor would make
  // that person's centroid NaN once named, silently breaking every match.
  return (
    !!box &&
    ["x", "y", "w", "h"].every((k) => Number.isFinite(box[k])) &&
    Array.isArray(face.descriptor) &&
    face.descriptor.length === DESCRIPTOR_LENGTH &&
    (face.descriptor as unknown[]).every((n) => Number.isFinite(n)) &&
    Number.isFinite(face.score)
  );
}

export async function POST(request: NextRequest) {
  let body: { results?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.results) || body.results.length === 0) {
    return NextResponse.json({ error: "results[] required" }, { status: 400 });
  }
  if (body.results.length > MAX_PAGE) {
    return NextResponse.json({ error: "Too many results" }, { status: 413 });
  }

  await ensureFacesSchema();

  // Resolve post_id for each media server-side (never trust the client for FKs),
  // and drop any media id that doesn't exist.
  const mediaIds = (body.results as ScanResult[]).map((r) => r.mediaId).filter((id) => typeof id === "string");
  if (mediaIds.length === 0) return NextResponse.json({ scanned: 0, faces: 0 });
  const postLookup = await db.execute({
    sql: `SELECT id, post_id FROM media WHERE id IN (${mediaIds.map(() => "?").join(",")})`,
    args: mediaIds,
  });
  const postByMedia = new Map(postLookup.rows.map((r) => [r.id as string, r.post_id as string]));

  const stmts: { sql: string; args: (string | number | null | Uint8Array)[] }[] = [];
  let faceCount = 0;

  for (const result of body.results as ScanResult[]) {
    const postId = postByMedia.get(result.mediaId);
    if (!postId) continue; // unknown media — skip silently

    // Re-scan safety: clear any prior AUTO (unnamed-source) faces for this media
    // so a repeat scan doesn't duplicate them. Human-named faces are preserved.
    stmts.push({
      sql: `DELETE FROM media_faces WHERE media_id = ? AND source = 'auto' AND person_id IS NULL`,
      args: [result.mediaId],
    });

    const faces = Array.isArray(result.faces) ? result.faces.filter(isValidFace).slice(0, MAX_FACES_PER_IMAGE) : [];
    for (const face of faces) {
      faceCount++;
      stmts.push({
        sql: `INSERT INTO media_faces (id, media_id, post_id, person_id, bbox_x, bbox_y, bbox_w, bbox_h, descriptor, detector_score, source)
              VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'auto')`,
        args: [
          nanoid(),
          result.mediaId,
          postId,
          face.box.x,
          face.box.y,
          face.box.w,
          face.box.h,
          descriptorToBytes(face.descriptor),
          face.score,
        ],
      });
    }

    stmts.push({
      sql: `UPDATE media SET faces_scanned_at = datetime('now') WHERE id = ?`,
      args: [result.mediaId],
    });
  }

  if (stmts.length > 0) await db.batch(stmts, "write");

  return NextResponse.json({ scanned: postByMedia.size, faces: faceCount });
}
