import { describe, it } from "node:test";
import assert from "node:assert/strict";
import exifr from "exifr";
import { resolveCaptureDate } from "../src/lib/media/capture-date";

/**
 * Phase 10.1a — guards the external contract the whole capture pipeline relies
 * on: exifr with reviveValues:false must return EXIF datetimes as RAW STRINGS,
 * not Dates. A Date would be JSON-serialized to a UTC instant on the client and
 * re-read as a shifted wall-clock on the server — the exact bug Phase 10 fixes.
 *
 * Run: npx tsx --test tests/exif-pipeline.test.ts
 */

/** Minimal JPEG (SOI + APP1/Exif + EOI), little-endian TIFF, with
 *  DateTimeOriginal + OffsetTimeOriginal. */
function buildExifJpeg(dto: string, offset: string): Buffer {
  const dtoStr = Buffer.concat([Buffer.from(dto, "ascii"), Buffer.from([0])]);
  const offStr = Buffer.concat([Buffer.from(offset, "ascii"), Buffer.from([0])]);
  const STR0 = 56;
  const STR1 = STR0 + dtoStr.length;
  const tiff = Buffer.alloc(STR1 + offStr.length);
  tiff.write("II", 0);
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); // IFD0: 1 entry
  tiff.writeUInt16LE(0x8769, 10); // ExifIFDPointer
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt32LE(0, 22);
  tiff.writeUInt16LE(2, 26); // Exif IFD: 2 entries
  tiff.writeUInt16LE(0x9003, 28); // DateTimeOriginal
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(dtoStr.length, 32);
  tiff.writeUInt32LE(STR0, 36);
  tiff.writeUInt16LE(0x9011, 40); // OffsetTimeOriginal
  tiff.writeUInt16LE(2, 42);
  tiff.writeUInt32LE(offStr.length, 44);
  tiff.writeUInt32LE(STR1, 48);
  tiff.writeUInt32LE(0, 52);
  dtoStr.copy(tiff, STR0);
  offStr.copy(tiff, STR1);

  const app1Body = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const app1Len = app1Body.length + 2;
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff]),
    app1Body,
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xd9])]);
}

describe("exifr reviveValues:false → raw string → resolveCaptureDate", () => {
  it("returns DateTimeOriginal as a string and resolves correctly through JSON", async () => {
    const buf = buildExifJpeg("2019:07:04 23:30:00", "+02:00");
    const tags = await exifr.parse(buf, {
      pick: ["DateTimeOriginal", "OffsetTimeOriginal"],
      reviveValues: false,
    });
    assert.equal(typeof tags?.DateTimeOriginal, "string");
    assert.equal(tags?.DateTimeOriginal, "2019:07:04 23:30:00");
    assert.equal(tags?.OffsetTimeOriginal, "+02:00");

    // Simulate the client→JSON→server hop.
    const overWire = JSON.parse(
      JSON.stringify({
        exifDateTimeOriginal: tags?.DateTimeOriginal ?? null,
        exifOffsetTimeOriginal: tags?.OffsetTimeOriginal ?? null,
      })
    );
    const r = resolveCaptureDate(overWire);
    assert.equal(r.source, "exif_offset");
    assert.equal(r.localDate, "2019-07-04");
    assert.equal(r.takenAt, "2019-07-04T21:30:00.000Z");
    assert.equal(r.tzOffsetMin, 120);
  });
});

describe("resolveOriginalCapture (shared server resolver)", () => {
  it("prefers the client's raw inputs when present", async () => {
    const { resolveOriginalCapture } = await import("../src/lib/media/extract");
    const buf = buildExifJpeg("2020:01:01 00:00:00", "+00:00");
    const r = await resolveOriginalCapture(
      { exifDateTimeOriginal: "2019:07:04 18:30:00" },
      buf,
      true,
      Date.UTC(2026, 6, 6)
    );
    assert.equal(r.source, "exif");
    assert.equal(r.localDate, "2019-07-04");
  });
  it("re-extracts from the original bytes when no client inputs were sent", async () => {
    const { resolveOriginalCapture } = await import("../src/lib/media/extract");
    const buf = buildExifJpeg("2019:07:04 23:30:00", "+02:00");
    const r = await resolveOriginalCapture(undefined, buf, true, Date.UTC(2026, 6, 6));
    assert.equal(r.source, "exif_offset");
    assert.equal(r.localDate, "2019-07-04");
    assert.equal(r.takenAt, "2019-07-04T21:30:00.000Z");
  });
  it("stamps upload_fallback when there is nothing to read", async () => {
    const { resolveOriginalCapture } = await import("../src/lib/media/extract");
    const r = await resolveOriginalCapture(undefined, null, false, Date.UTC(2026, 6, 6));
    assert.equal(r.source, "upload_fallback");
    assert.equal(r.localDate, "2026-07-06");
  });
});
