import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultLayout,
  defaultLayoutCounts,
  generatePhotosetLayout,
} from "../src/lib/media/layout";
import { dateFromFilename } from "../src/lib/media/exif";

/**
 * Shared media lib tests (Phase 9-pre).
 * Run: npx tsx --test tests/media-lib.test.ts
 */

describe("defaultLayoutCounts", () => {
  it("handles 0-4 photos", () => {
    assert.deepEqual(defaultLayoutCounts(0), []);
    assert.deepEqual(defaultLayoutCounts(1), [1]);
    assert.deepEqual(defaultLayoutCounts(2), [2]);
    assert.deepEqual(defaultLayoutCounts(3), [3]);
    assert.deepEqual(defaultLayoutCounts(4), [2, 2]);
  });

  it("uses rows of 3 with a 2+2 tail, never a row of 4", () => {
    assert.deepEqual(defaultLayoutCounts(5), [3, 2]);
    assert.deepEqual(defaultLayoutCounts(6), [3, 3]);
    assert.deepEqual(defaultLayoutCounts(7), [3, 2, 2]);
    assert.deepEqual(defaultLayoutCounts(8), [3, 3, 2]);
    assert.deepEqual(defaultLayoutCounts(10), [3, 3, 2, 2]);
  });

  it("rows always sum to the photo count, rows are 1-3 wide", () => {
    for (let n = 1; n <= 60; n++) {
      const counts = defaultLayoutCounts(n);
      assert.equal(counts.reduce((a, b) => a + b, 0), n, `sum for n=${n}`);
      assert.ok(counts.every((c) => c >= 1 && c <= 3), `row sizes for n=${n}`);
    }
  });
});

describe("defaultLayout / generatePhotosetLayout parity", () => {
  it("layout string digits match the 2D row lengths", () => {
    for (let n = 1; n <= 30; n++) {
      const items = Array.from({ length: n }, (_, i) => i);
      const rows = defaultLayout(items);
      assert.equal(generatePhotosetLayout(n), rows.map((r) => r.length).join(""));
      assert.deepEqual(rows.flat(), items, `order preserved for n=${n}`);
    }
  });
});

describe("dateFromFilename", () => {
  it("parses common phone/scanner patterns", () => {
    const cases: Array<[string, string]> = [
      ["IMG_20190704_123456.jpg", "2019-07-04"],
      ["2019-07-04 párty.jpg", "2019-07-04"],
      ["scan_2003.12.25_001.jpg", "2003-12-25"],
      ["20191231.jpg", "2019-12-31"],
      ["PHOTO-2021_01_09.jpeg", "2021-01-09"],
    ];
    for (const [name, expected] of cases) {
      const d = dateFromFilename(name);
      assert.ok(d, `should parse ${name}`);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      assert.equal(iso, expected, name);
    }
  });

  it("rejects non-dates and impossible dates", () => {
    assert.equal(dateFromFilename("IMG_1234.jpg"), null);
    assert.equal(dateFromFilename("DSC00042.jpg"), null);
    assert.equal(dateFromFilename("20191350.jpg"), null); // month 13
    assert.equal(dateFromFilename("20190230.jpg"), null); // Feb 30
    assert.equal(dateFromFilename("12345678.jpg"), null); // not 19xx/20xx
  });
});
