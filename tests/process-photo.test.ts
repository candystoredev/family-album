import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import exifr from "exifr";
import { processUploadPhoto, MAX_UPLOAD_BYTES } from "../src/lib/media/process-photo";

/**
 * Phase 11d — the served-original re-encode that strips EXIF/GPS.
 * Run: npx tsx --test tests/process-photo.test.ts
 *
 * Guards the leak this phase fixes: an "already a clean JPEG" fast path in
 * upload/complete/route.ts used to serve the raw downloaded bytes (EXIF/GPS
 * intact) as the public original.jpg. processUploadPhoto() must always
 * re-encode via sharp with no withMetadata(), which drops all EXIF.
 */

/** A tiny JPEG with GPS + device EXIF embedded, orientation upright (1) so it
 *  would have hit the old "already processed" fast path. Sharp's withExif
 *  IFD3 is the documented way to write GPS tags (see node_modules/sharp/lib/
 *  output.js withExif jsdoc example). */
async function jpegWithGpsExif(width = 40, height = 30): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } },
  })
    .withExif({
      IFD0: { Make: "TestCam", Model: "Unit Test 3000", Software: "process-photo.test.ts" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "51/1 30/1 3230/100",
        GPSLongitudeRef: "W",
        GPSLongitude: "0/1 7/1 4366/100",
      },
    })
    .jpeg()
    .toBuffer();
}

describe("processUploadPhoto", () => {
  it("strips GPS and all other EXIF from the output", async () => {
    const input = await jpegWithGpsExif();

    // Sanity-check the fixture actually carries EXIF/GPS before processing —
    // otherwise a false-negative test would prove nothing.
    const inputMeta = await sharp(input).metadata();
    assert.ok(inputMeta.exif, "fixture should have embedded EXIF");
    const inputGps = await exifr.gps(input);
    assert.ok(inputGps, "fixture should have embedded GPS");
    assert.ok(Math.abs(inputGps!.latitude - 51.5) < 0.01);

    const { data } = await processUploadPhoto(input);

    const outputMeta = await sharp(data).metadata();
    assert.equal(outputMeta.exif, undefined, "output must have no EXIF block at all");

    const outputGps = await exifr.gps(data);
    assert.equal(outputGps, undefined, "output must have no GPS");

    const outputTags = await exifr.parse(data);
    assert.equal(outputTags, undefined, "output must have no readable EXIF tags");
  });

  it("returns the re-encoded width and height", async () => {
    const input = await jpegWithGpsExif(123, 87);
    const { data, width, height } = await processUploadPhoto(input);
    assert.equal(width, 123);
    assert.equal(height, 87);

    // width/height must match what's actually in the output bytes, not just
    // an independent guess.
    const meta = await sharp(data).metadata();
    assert.equal(meta.width, 123);
    assert.equal(meta.height, 87);
  });

  it("re-encodes even an already-upright plain JPEG (no fast path)", async () => {
    // orientation undefined/1 + format jpeg is exactly what the old
    // `alreadyProcessed` branch matched and served unmodified.
    const plain = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .withExif({ IFD0: { Make: "ShouldBeStripped" } })
      .jpeg()
      .toBuffer();
    const meta = await sharp(plain).metadata();
    // Matches the old alreadyProcessed condition this test guards against:
    // format jpeg + no orientation tag (or orientation 1, upright).
    assert.ok(!meta.orientation || meta.orientation === 1);
    assert.equal(meta.format, "jpeg");

    const { data } = await processUploadPhoto(plain);
    assert.notDeepEqual(data, plain, "output bytes must differ from the raw upload");
    const outMeta = await sharp(data).metadata();
    assert.equal(outMeta.exif, undefined);
  });
});

describe("MAX_UPLOAD_BYTES", () => {
  it("is a sane positive byte count (50 MB)", () => {
    assert.equal(MAX_UPLOAD_BYTES, 50 * 1024 * 1024);
    assert.ok(MAX_UPLOAD_BYTES > 0);
  });
});
