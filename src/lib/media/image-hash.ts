import sharp from "sharp";

/**
 * Perceptual hash (dHash) of an image, as 16 hex chars (64 bits). Server-side,
 * computed from the generated thumbnail so it matches how the Phase 10.3 backfill
 * will hash stored thumbnails — same algorithm, same input type, so live and
 * backfill hashes are directly comparable (Hamming distance).
 *
 * dHash: downscale to 9x8 greyscale, then for each row emit a bit per adjacent
 * pixel pair (left < right). Robust to scaling/JPEG re-encoding, which is exactly
 * the album-thumbnail-vs-original matching case.
 */
export async function perceptualHash(buf: Buffer): Promise<string | null> {
  try {
    const W = 9;
    const H = 8;
    const data = await sharp(buf)
      .greyscale()
      .resize(W, H, { fit: "fill" })
      .raw()
      .toBuffer();
    let hex = "";
    let nibble = 0;
    let bitsInNibble = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W - 1; x++) {
        const i = y * W + x;
        const bit = data[i] < data[i + 1] ? 1 : 0;
        nibble = (nibble << 1) | bit;
        if (++bitsInNibble === 4) {
          hex += nibble.toString(16);
          nibble = 0;
          bitsInNibble = 0;
        }
      }
    }
    return hex; // 64 bits → 16 hex chars
  } catch {
    return null;
  }
}

/** Dominant colour as a #rrggbb hex string, via sharp's histogram. */
export async function dominantColor(buf: Buffer): Promise<string | null> {
  try {
    const { dominant } = await sharp(buf).stats();
    const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return `#${h(dominant.r)}${h(dominant.g)}${h(dominant.b)}`;
  } catch {
    return null;
  }
}
