import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isHeic } from "../src/lib/media/compress";

/**
 * Phase 10.1d — HEIC detection. Run: npx tsx --test tests/heic.test.ts
 * (compress.ts only touches DOM/WASM inside functions, so importing it and
 * calling the pure isHeic() in Node is safe.)
 */

// Minimal File stand-in: isHeic only reads .type and .name.
const f = (name: string, type: string) => ({ name, type }) as File;

describe("isHeic", () => {
  it("matches HEIC/HEIF mime types incl. sequence variants", () => {
    assert.equal(isHeic(f("IMG_1.heic", "image/heic")), true);
    assert.equal(isHeic(f("IMG_1.HEIC", "image/heif")), true);
    assert.equal(isHeic(f("live.heic", "image/heic-sequence")), true);
    assert.equal(isHeic(f("live.heif", "image/heif-sequence")), true);
  });

  it("falls back to extension when the mime type is missing or generic", () => {
    assert.equal(isHeic(f("IMG_1.HEIC", "")), true);
    assert.equal(isHeic(f("IMG_1.heic", "application/octet-stream")), true);
    assert.equal(isHeic(f("IMG_1.heif", "")), true);
  });

  it("is false for ordinary images and non-HEIC with empty type", () => {
    assert.equal(isHeic(f("IMG_1.jpg", "image/jpeg")), false);
    assert.equal(isHeic(f("IMG_1.png", "image/png")), false);
    assert.equal(isHeic(f("IMG_1.jpg", "")), false);
    assert.equal(isHeic(f("clip.mov", "video/quicktime")), false);
  });
});
