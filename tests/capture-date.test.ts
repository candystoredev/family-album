import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  earliestCapture,
  parseExifWallClock,
  parseTzOffset,
  parseAppleCreationDate,
  resolveCaptureDate,
} from "../src/lib/media/capture-date";

/**
 * Phase 10.1 — unified capture-date model.
 * Run: npx tsx --test tests/capture-date.test.ts
 */

describe("parseTzOffset", () => {
  it("parses colon and non-colon offsets and Z", () => {
    assert.equal(parseTzOffset("+02:00"), 120);
    assert.equal(parseTzOffset("+0200"), 120);
    assert.equal(parseTzOffset("-05:00"), -300);
    assert.equal(parseTzOffset("-0530"), -330);
    assert.equal(parseTzOffset("Z"), 0);
    assert.equal(parseTzOffset("+00:00"), 0);
  });
  it("rejects junk and out-of-range", () => {
    assert.equal(parseTzOffset(null), null);
    assert.equal(parseTzOffset(""), null);
    assert.equal(parseTzOffset("nonsense"), null);
    assert.equal(parseTzOffset("+15:00"), null);
  });
});

describe("parseExifWallClock", () => {
  it("parses the canonical EXIF colon-date format", () => {
    assert.deepEqual(parseExifWallClock("2019:07:04 18:30:05"), {
      year: 2019, month: 7, day: 4, hour: 18, minute: 30, second: 5,
    });
  });
  it("recovers wall-clock from a Date regardless of host tz", () => {
    // exifr builds this Date in host-local time from naive components; the local
    // accessors must recover the original numbers.
    const d = new Date(2019, 6, 4, 18, 30, 5);
    assert.deepEqual(parseExifWallClock(d), {
      year: 2019, month: 7, day: 4, hour: 18, minute: 30, second: 5,
    });
  });
  it("rejects impossible dates and garbage", () => {
    assert.equal(parseExifWallClock("2019:02:30 00:00:00"), null);
    assert.equal(parseExifWallClock("not a date"), null);
  });
});

describe("parseAppleCreationDate", () => {
  it("keeps the exact instant and extracts the offset", () => {
    const r = parseAppleCreationDate("2026-06-22T18:03:00+0100");
    assert.equal(r?.tzOffsetMin, 60);
    assert.equal(r?.instant, "2026-06-22T17:03:00.000Z");
  });
});

describe("resolveCaptureDate — the client/server agreement guarantee", () => {
  it("naive EXIF resolves identically no matter how it's supplied", () => {
    // String path (server) vs Date path (client via exifr) must agree.
    const fromString = resolveCaptureDate({ exifDateTimeOriginal: "2019:07:04 23:30:00" });
    const fromDate = resolveCaptureDate({
      exifDateTimeOriginal: new Date(2019, 6, 4, 23, 30, 0),
    });
    assert.deepEqual(fromString, fromDate);
    assert.equal(fromString.source, "exif");
    assert.equal(fromString.confidence, "medium");
    assert.equal(fromString.tzOffsetMin, null);
    // Late-night shot keeps its calendar day (the grouping bug).
    assert.equal(fromString.localDate, "2019-07-04");
    // Deterministic instant: naive wall-clock treated as UTC.
    assert.equal(fromString.takenAt, "2019-07-04T23:30:00.000Z");
  });

  it("EXIF + offset yields a true instant but the local day is unchanged", () => {
    const r = resolveCaptureDate({
      exifDateTimeOriginal: "2019:07:04 23:30:00",
      exifOffsetTimeOriginal: "+02:00",
    });
    assert.equal(r.source, "exif_offset");
    assert.equal(r.confidence, "high");
    assert.equal(r.tzOffsetMin, 120);
    assert.equal(r.localDate, "2019-07-04"); // local day, not the UTC day
    assert.equal(r.takenAt, "2019-07-04T21:30:00.000Z"); // 23:30 +02:00 → 21:30Z
  });

  it("a UTC-midnight-crossing offset photo groups to the LOCAL day", () => {
    // 00:30 local on Jul 5 at +02:00 is 22:30Z on Jul 4. Grouping must follow
    // the local day (Jul 5), not the UTC day (Jul 4).
    const r = resolveCaptureDate({
      exifDateTimeOriginal: "2019:07:05 00:30:00",
      exifOffsetTimeOriginal: "+02:00",
    });
    assert.equal(r.localDate, "2019-07-05");
    assert.equal(r.takenAt, "2019-07-04T22:30:00.000Z");
  });
});

describe("resolveCaptureDate — videos", () => {
  it("Apple creationdate is high-confidence with a true local day", () => {
    const apple = parseAppleCreationDate("2026-06-22T23:30:00+0100")!;
    const r = resolveCaptureDate({ videoCreation: apple });
    assert.equal(r.source, "video_meta");
    assert.equal(r.confidence, "high");
    assert.equal(r.tzOffsetMin, 60);
    assert.equal(r.localDate, "2026-06-22"); // 23:30 local, not 22:30Z → Jun 22
    assert.equal(r.takenAt, "2026-06-22T22:30:00.000Z");
  });

  it("mvhd (UTC, no tz) is medium-confidence", () => {
    const r = resolveCaptureDate({
      videoCreation: { instant: "2026-06-22T22:30:00.000Z", tzOffsetMin: null },
    });
    assert.equal(r.source, "video_meta");
    assert.equal(r.confidence, "medium");
    assert.equal(r.tzOffsetMin, null);
    assert.equal(r.localDate, "2026-06-22");
  });
});

describe("resolveCaptureDate — fallbacks and priority", () => {
  it("manual entry beats EXIF", () => {
    const r = resolveCaptureDate({
      manual: "2020-01-15",
      exifDateTimeOriginal: "2019:07:04 18:30:00",
    });
    assert.equal(r.source, "manual");
    assert.equal(r.confidence, "high");
    assert.equal(r.localDate, "2020-01-15");
  });

  it("filename date is low-confidence, date only", () => {
    const r = resolveCaptureDate({ filename: "IMG_20190704_120000.jpg" });
    assert.equal(r.source, "filename");
    assert.equal(r.confidence, "low");
    assert.equal(r.localDate, "2019-07-04");
  });

  it("falls to mtime, then upload_fallback", () => {
    const mtime = Date.UTC(2021, 4, 9, 15, 0, 0);
    const r1 = resolveCaptureDate({ fileLastModifiedMs: mtime });
    assert.equal(r1.source, "file_mtime");
    assert.equal(r1.localDate, "2021-05-09");

    const r2 = resolveCaptureDate({}, Date.UTC(2026, 5, 23, 10, 0, 0));
    assert.equal(r2.source, "upload_fallback");
    assert.equal(r2.localDate, "2026-06-23");
    assert.equal(r2.takenAt, "2026-06-23T10:00:00.000Z");

    const r3 = resolveCaptureDate({});
    assert.equal(r3.source, "upload_fallback");
    assert.equal(r3.takenAt, null); // no now supplied → caller stamps it
  });

  it("skips an unparseable manual value and uses the next source", () => {
    const r = resolveCaptureDate({
      manual: "garbage",
      exifDateTimeOriginal: "2019:07:04 18:30:00",
    });
    assert.equal(r.source, "exif");
  });
});

describe("earliestCapture", () => {
  // The post-rollup rule shared by the server and the upload page's
  // "Suggested date" preview.
  it("picks the earliest resolvable instant across media", () => {
    const flyer = resolveCaptureDate({ exifDateTimeOriginal: "2026:07:06 09:00:00" });
    const party = resolveCaptureDate({ exifDateTimeOriginal: "2026:07:04 20:10:00" });
    const undated = resolveCaptureDate({}); // no nowMs → takenAt null
    assert.equal(earliestCapture([flyer, undated, party])?.localDate, "2026-07-04");
  });
  it("breaks takenAt ties by array (display) order", () => {
    const a = resolveCaptureDate({ exifDateTimeOriginal: "2026:07:04 20:10:00" });
    const b = {
      ...resolveCaptureDate({ exifDateTimeOriginal: "2026:07:04 20:10:00" }),
      localDate: "marker",
    };
    assert.equal(earliestCapture([a, b])?.localDate, "2026-07-04");
  });
  it("returns null when nothing has an instant", () => {
    assert.equal(earliestCapture([]), null);
    assert.equal(earliestCapture([resolveCaptureDate({}), null, undefined]), null);
  });
});
