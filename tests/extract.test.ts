import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapTagsToExtras } from "../src/lib/media/extract";

/**
 * Phase 10.1c — the pure exifr-tags → {gps, device, raw} mapper shared by the
 * client and the server originals-path fallback. Run: npx tsx --test tests/extract.test.ts
 */

describe("mapTagsToExtras", () => {
  it("maps GPS + device from a typical photo tag set", () => {
    const e = mapTagsToExtras({
      latitude: 51.5,
      longitude: -0.12,
      GPSAltitude: 35,
      Make: "Apple",
      Model: "iPhone 15 Pro",
      LensModel: "iPhone 15 Pro back camera 6.86mm f/1.78",
      ISO: 100,
      FNumber: 1.78,
      ExposureTime: 0.005,
      FocalLength: 6.86,
    });
    assert.deepEqual(e.gps, { lat: 51.5, lng: -0.12, altitude: 35 });
    assert.equal(e.device?.make, "Apple");
    assert.equal(e.device?.model, "iPhone 15 Pro");
    assert.equal(e.device?.iso, 100);
    assert.equal(e.device?.aperture, 1.78);
    assert.equal(e.device?.shutterSpeed, "0.005");
    assert.equal(e.device?.focalLength, 6.86);
    assert.ok(e.raw && typeof JSON.stringify(e.raw) === "string");
  });

  it("returns gps=null when there are no coordinates", () => {
    const e = mapTagsToExtras({ Make: "Canon", Model: "EOS R6" });
    assert.equal(e.gps, null);
    assert.equal(e.device?.make, "Canon");
  });

  it("is all-null for empty/absent tags", () => {
    assert.deepEqual(mapTagsToExtras(null), { gps: null, device: null, raw: null });
  });

  it("sanitizes non-JSON values (BigInt, Uint8Array) in raw", () => {
    const e = mapTagsToExtras({
      Make: "X",
      bigOffset: BigInt(123),
      thumb: new Uint8Array([1, 2, 3]),
    });
    assert.notEqual(e.raw, null);
    const round = JSON.parse(JSON.stringify(e.raw));
    assert.equal(round.bigOffset, "123");
    assert.deepEqual(round.thumb, [1, 2, 3]);
  });
});
