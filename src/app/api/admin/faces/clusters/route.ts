import { NextResponse } from "next/server";
import { ensureFacesSchema } from "@/lib/schema";
import { loadPersonReferences, loadUnnamedFaces, toFaceVectors } from "@/lib/faces/server";
import { clusterFaces } from "@/lib/faces/cluster";

/**
 * Group the unnamed-face backlog into per-person clusters for the review page.
 * Clustering runs server-side (the pure `clusterFaces`) so descriptors never
 * leave the server; the client gets only display info (a crop box over the
 * same-origin thumbnail proxy) plus each cluster's best "is this <known
 * person>?" suggestion. Largest clusters first — the most-photographed faces
 * are the ones worth naming.
 *
 * Admin-gated by middleware.
 */

// Cap the backlog processed in one pass. Family-album scale is small; this is a
// guard against an O(n²) blow-up if a huge archive is scanned at once. When hit,
// the newest faces are clustered first (loadUnnamedFaces orders DESC) and the
// response flags the remainder so the UI can tell the user to name a batch and
// reload.
const MAX_FACES = 600;

export async function GET() {
  await ensureFacesSchema();

  const [faces, references] = await Promise.all([
    loadUnnamedFaces(MAX_FACES + 1),
    loadPersonReferences(),
  ]);
  const truncated = faces.length > MAX_FACES;
  const working = truncated ? faces.slice(0, MAX_FACES) : faces;

  const byId = new Map(working.map((f) => [f.id, f]));
  const clusters = clusterFaces(toFaceVectors(working), references);

  return NextResponse.json({
    truncated,
    clusters: clusters.map((c) => ({
      suggestion: c.suggestion,
      faces: c.faceIds.map((id) => {
        const f = byId.get(id)!;
        return {
          id: f.id,
          mediaId: f.mediaId,
          postId: f.postId,
          box: f.box,
          imageUrl: `/api/admin/faces/image/${f.mediaId}`,
        };
      }),
    })),
  });
}
