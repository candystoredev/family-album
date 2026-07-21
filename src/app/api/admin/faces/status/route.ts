import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureFacesSchema } from "@/lib/schema";

/**
 * Faces → People counters. Two consumers:
 *  - the compose page's enrichment hook reads `referenceCount` to decide whether
 *    to run in-browser face detection at all (zero named people ⇒ nothing to
 *    match ⇒ don't pay the ~7 MB model load);
 *  - the /admin/people/faces review page shows scan + naming progress.
 *
 * Admin-gated by middleware.
 */
export async function GET() {
  await ensureFacesSchema();

  const [refPeople, named, unnamed, scanned, unscanned] = await Promise.all([
    db.execute(`SELECT COUNT(DISTINCT person_id) AS n FROM media_faces WHERE person_id IS NOT NULL`),
    db.execute(`SELECT COUNT(*) AS n FROM media_faces WHERE person_id IS NOT NULL`),
    db.execute(`SELECT COUNT(*) AS n FROM media_faces WHERE person_id IS NULL`),
    db.execute(`SELECT COUNT(*) AS n FROM media WHERE type = 'photo' AND faces_scanned_at IS NOT NULL`),
    db.execute(`SELECT COUNT(*) AS n FROM media WHERE type = 'photo' AND faces_scanned_at IS NULL`),
  ]);

  const num = (r: { rows: Record<string, unknown>[] }) => Number(r.rows[0]?.n ?? 0);

  return NextResponse.json({
    referenceCount: num(refPeople),
    namedFaceCount: num(named),
    unnamedFaceCount: num(unnamed),
    scannedCount: num(scanned),
    unscannedCount: num(unscanned),
  });
}
