import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDisplayDate, isEstimatedDate } from "../src/lib/datetime";

/**
 * Phase 10.2c — display helpers. Run: npx tsx --test tests/display-date.test.ts
 * Run under TZ=Pacific/Kiritimati / America/Los_Angeles to confirm the
 * local_date path never shifts the shown day by timezone.
 */

describe("formatDisplayDate", () => {
  it("uses local_date (tz-independent) for the shown day", () => {
    assert.equal(formatDisplayDate("2026-06-20 14:20:16.000", "2026-06-20"), "Jun 20, 2026");
    assert.equal(
      formatDisplayDate("2026-06-20 14:20:16.000", "2026-06-20", { long: true }),
      "June 20, 2026"
    );
  });

  it("prefers local_date over a mismatched legacy date", () => {
    // legacy says Jun 25 (upload), true local day is Jun 23.
    assert.equal(formatDisplayDate("2026-06-25 13:40:53.794", "2026-06-23"), "Jun 23, 2026");
  });

  it("falls back to the legacy date when local_date is absent", () => {
    assert.match(formatDisplayDate("2012-09-11T04:00:00.000Z", null), /Sep \d{1,2}, 2012/);
  });

  it("does not shift the day by timezone (local_date path)", () => {
    // A pure-string format — must be identical regardless of host TZ. A late
    // local_date that would cross midnight if mistakenly run through a Date.
    assert.equal(formatDisplayDate("2026-06-20 23:59:00.000", "2026-06-20"), "Jun 20, 2026");
  });
});

describe("isEstimatedDate", () => {
  it("is true only for fallback sources", () => {
    for (const s of ["filename", "file_mtime", "upload_fallback"]) {
      assert.equal(isEstimatedDate(s), true, s);
    }
    for (const s of ["exif", "exif_offset", "video_meta", "manual", null, undefined, ""]) {
      assert.equal(isEstimatedDate(s as string | null | undefined), false, String(s));
    }
  });
});
