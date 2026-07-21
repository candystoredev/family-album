import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { downloadFromR2 } from "@/lib/r2";

/**
 * Same-origin thumbnail proxy for the face scanner. Face detection reads pixels
 * off a <canvas>, which taints (and blocks readback on) cross-origin images
 * unless the source sends CORS headers — the public R2 bucket doesn't guarantee
 * that. Serving the thumbnail bytes from our own origin keeps the canvas clean
 * and also satisfies the strict CSP (img-src 'self'). Thumbnails are ~400px, so
 * this is cheap even across the whole archive. Admin-gated by middleware.
 */

export const maxDuration = 15;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  const { mediaId } = await params;

  const res = await db.execute({
    sql: `SELECT thumbnail_r2_key, r2_key, type FROM media WHERE id = ?`,
    args: [mediaId],
  });
  const row = res.rows[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Prefer the thumbnail; fall back to the processed original (a photo without a
  // stored thumb). Videos have only a poster thumb — no original image to read.
  const key = (row.thumbnail_r2_key as string | null) ?? (row.type === "photo" ? (row.r2_key as string) : null);
  if (!key) return NextResponse.json({ error: "No image" }, { status: 404 });

  try {
    const buffer = await downloadFromR2(key);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        // Private: this is behind the admin session; don't let shared caches keep it.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
  }
}
