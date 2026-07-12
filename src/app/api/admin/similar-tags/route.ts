import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { perceptualHash, hammingDistanceHex } from "@/lib/media/image-hash";

/**
 * Model-free tag propagation (compose-time). The client posts the same small
 * analysis rendition used for OCR/enrichment; we dHash it server-side (same
 * algorithm as every stored media row) and look for visually-identical media
 * already in the album — re-shares, WhatsApp copies, crops, re-encodes. Tags
 * on the matching posts come back as suggestions, since a copy of an
 * already-tagged photo almost certainly wants the same tags.
 *
 * No AI anywhere in this path: canvas resize (client), dHash + Hamming
 * distance (here), and a join. Admin-gated by middleware.
 */

export const maxDuration = 15;

const MAX_BASE64_LENGTH = 2_800_000;
// ≤6 differing bits of 64 ≈ "the same picture" for dHash; crops/borders
// push toward the top of that range, unrelated photos land far above it.
const MAX_HAMMING = 6;

export async function POST(request: NextRequest) {
  let body: { imageBase64?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { imageBase64 } = body;
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
  }
  if (imageBase64.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: "Image too large" }, { status: 413 });
  }

  try {
    const hash = await perceptualHash(Buffer.from(imageBase64, "base64"));
    if (!hash) return NextResponse.json({ tags: [] });

    const media = await db.execute(
      "SELECT phash, post_id FROM media WHERE phash IS NOT NULL"
    );
    const matchedPosts = new Set<string>();
    for (const row of media.rows) {
      const d = hammingDistanceHex(hash, row.phash as string);
      if (d !== null && d <= MAX_HAMMING) matchedPosts.add(row.post_id as string);
    }
    if (matchedPosts.size === 0) return NextResponse.json({ tags: [] });

    const ids = [...matchedPosts];
    const tags = await db.execute({
      sql: `SELECT DISTINCT t.name FROM post_tags pt
            INNER JOIN tags t ON t.id = pt.tag_id
            WHERE pt.post_id IN (${ids.map(() => "?").join(",")})`,
      args: ids,
    });
    return NextResponse.json({
      tags: tags.rows.map((r) => r.name as string),
      matchedPosts: ids.length,
    });
  } catch (error) {
    console.error("similar-tags error:", error);
    return NextResponse.json({ error: "Lookup failed" }, { status: 502 });
  }
}
