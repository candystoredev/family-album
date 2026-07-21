import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureFacesSchema } from "@/lib/schema";

/**
 * Dismiss faces that aren't worth naming — the tiny/false detections the tiny
 * detector inevitably produces (a face in a poster, a blurry background head).
 * We delete the unnamed rows outright; the photo stays marked scanned, so they
 * won't come back unless it's explicitly re-scanned. Only unnamed auto faces can
 * be dismissed — a human-confirmed face is never deleted through this path.
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

  const placeholders = faceIds.map(() => "?").join(",");
  const res = await db.execute({
    sql: `DELETE FROM media_faces WHERE id IN (${placeholders}) AND person_id IS NULL`,
    args: faceIds,
  });

  return NextResponse.json({ ignored: res.rowsAffected ?? 0 });
}
