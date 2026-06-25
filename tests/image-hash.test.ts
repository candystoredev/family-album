import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { perceptualHash, dominantColor } from "../src/lib/media/image-hash";

/**
 * Phase 10.1b — server-side perceptual hash + dominant colour.
 * Run: npx tsx --test tests/image-hash.test.ts
 *
 * The phash must be stable when an image is downscaled + re-encoded (the
 * album-thumbnail-vs-original case the 10.3 backfill relies on) and distinct
 * across different content.
 */

function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

function gradient(w: number, h: number, vertical = false): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.round((vertical ? y / h : x / w) * 255);
      const i = (y * w + x) * 3;
      buf[i] = buf[i + 1] = buf[i + 2] = v;
    }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
}

describe("perceptualHash", () => {
  it("is 64 bits (16 hex chars)", async () => {
    const h = await perceptualHash(await gradient(120, 90));
    assert.equal(h?.length, 16);
  });

  it("is stable under downscale + JPEG re-encode", async () => {
    const big = await gradient(240, 180);
    const thumb = await sharp(big).resize(80, 60).jpeg({ quality: 70 }).toBuffer();
    const hBig = (await perceptualHash(big))!;
    const hThumb = (await perceptualHash(thumb))!;
    assert.ok(hamming(hBig, hThumb) <= 4, `expected near-identical, got ${hamming(hBig, hThumb)}`);
  });

  it("differs across different content", async () => {
    const hHoriz = (await perceptualHash(await gradient(240, 180)))!;
    const hVert = (await perceptualHash(await gradient(240, 180, true)))!;
    assert.ok(hamming(hHoriz, hVert) >= 12, `expected distinct, got ${hamming(hHoriz, hVert)}`);
  });

  it("returns null on undecodable input", async () => {
    assert.equal(await perceptualHash(Buffer.from("not an image")), null);
  });
});

describe("dominantColor", () => {
  it("returns the dominant colour as #rrggbb", async () => {
    const green = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 51, g: 170, b: 119 } },
    })
      .jpeg()
      .toBuffer();
    const c = await dominantColor(green);
    assert.match(c!, /^#[0-9a-f]{6}$/);
    // Green channel clearly dominant over red/blue.
    const g = parseInt(c!.slice(3, 5), 16);
    const r = parseInt(c!.slice(1, 3), 16);
    assert.ok(g > r, `expected green>red, got ${c}`);
  });
});
