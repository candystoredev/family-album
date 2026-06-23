/**
 * Unified capture-date model (Phase 10.1).
 *
 * The motivating bug: a photo's capture date used to be interpreted differently
 * depending on which code path ran. The client read a naive EXIF timestamp as
 * *browser-local* (`new Date(str)`), then `.toISOString()`'d it to UTC; the
 * server fallback read the same naive string as *server-local* (UTC on Vercel).
 * Same photo, different instant, sometimes a different calendar day.
 *
 * The fix is to separate two concerns and compute both with ONE rule that is
 * independent of whatever machine runs it:
 *
 *   • `takenAt`   — a precise UTC instant, used only for *ordering*.
 *   • `localDate` — the capture-local calendar day (`YYYY-MM-DD`), used for
 *                   *grouping* / "on this day". Derived from wall-clock
 *                   components directly, so no timezone can move a photo to the
 *                   wrong day.
 *
 * Crucially, a naive EXIF datetime (no offset) is NEVER passed through
 * `new Date(str)` (which would apply the host timezone). We parse its
 * components and build the instant explicitly with `Date.UTC(...)`, so the
 * client and server produce byte-identical results.
 *
 * This module is pure (no I/O): the client feeds it values from `exifr` + the
 * video container parser; the server feeds it values from `sharp`/the same
 * container parser. Same inputs → same output, by construction.
 */

/** Where a media item's date came from. Mirrors the `date_source` column. */
export type DateSource =
  | "exif_offset" // EXIF DateTimeOriginal + OffsetTimeOriginal — true instant + tz
  | "video_meta" // video container creation time (Apple = +tz, mvhd = UTC only)
  | "exif" // EXIF DateTimeOriginal, no offset — naive wall-clock
  | "filename" // date parsed from the filename
  | "file_mtime" // filesystem last-modified time
  | "manual" // user-entered
  | "upload_fallback"; // nothing available — stamped at upload time

export type DateConfidence = "high" | "medium" | "low";

export interface CaptureDate {
  /** Precise capture instant, UTC ISO-8601. For ORDER BY. Null only if unknown. */
  takenAt: string | null;
  /** Capture tz offset in minutes east of UTC (e.g. +60 for +01:00), if known. */
  tzOffsetMin: number | null;
  /** Capture-local calendar day, `YYYY-MM-DD`. For grouping. */
  localDate: string | null;
  source: DateSource;
  confidence: DateConfidence;
}

/** Wall-clock calendar/time components, with no timezone attached. */
export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
}

export interface CaptureDateInput {
  /** EXIF DateTimeOriginal — either the naive "YYYY:MM:DD HH:MM:SS" string or a
   *  Date already parsed by exifr (which, with no offset, is browser-local — we
   *  re-read its wall-clock components, not its instant). */
  exifDateTimeOriginal?: string | Date | null;
  /** EXIF OffsetTimeOriginal, e.g. "+02:00", "+0200", "-05:00", "Z". */
  exifOffsetTimeOriginal?: string | null;
  /** Video container creation time, already resolved to an instant by the
   *  container parser. `tzOffsetMin` is known for Apple `creationdate`, null for
   *  bare `mvhd` (which is UTC with no local-tz information). */
  videoCreation?: { instant: string | Date; tzOffsetMin: number | null } | null;
  /** Original filename, for the `IMG_20190704` / `2019-07-04` date fallback. */
  filename?: string | null;
  /** `file.lastModified` (ms since epoch). Last-resort fallback. */
  fileLastModifiedMs?: number | null;
  /** User-entered date (`YYYY-MM-DD` or a full `datetime-local` value). Wins. */
  manual?: string | null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Format wall-clock Y/M/D as the grouping key, tz-independent. */
function localDateOf(w: Pick<WallClock, "year" | "month" | "day">): string {
  return `${w.year}-${pad2(w.month)}-${pad2(w.day)}`;
}

/** True iff the components form a real calendar date (rejects e.g. Feb 30). */
function isRealDate(w: WallClock): boolean {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second));
  return (
    d.getUTCFullYear() === w.year &&
    d.getUTCMonth() === w.month - 1 &&
    d.getUTCDate() === w.day
  );
}

/**
 * Parse a naive EXIF datetime ("YYYY:MM:DD HH:MM:SS", optionally with sub-second
 * or a trailing offset we ignore here) into wall-clock components. Also accepts
 * a Date (from exifr): we take its *local* getFullYear/getMonth/... because
 * exifr builds the Date in the host tz from the same naive wall-clock, so the
 * local accessors recover the original wall-clock numbers regardless of host tz.
 */
export function parseExifWallClock(value: string | Date): WallClock | null {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hour: value.getHours(),
      minute: value.getMinutes(),
      second: value.getSeconds(),
    };
  }
  const m = value
    .trim()
    .match(/^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const w: WallClock = {
    year: +y,
    month: +mo,
    day: +d,
    hour: +h,
    minute: +mi,
    second: +s,
  };
  return isRealDate(w) ? w : null;
}

/** Parse a tz offset string to minutes east of UTC. "Z"/"+00:00" → 0. */
export function parseTzOffset(offset: string | null | undefined): number | null {
  if (!offset) return null;
  const s = offset.trim();
  if (s === "Z" || s === "z") return 0;
  const m = s.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return null;
  const [, sign, hh, mm] = m;
  const mins = +hh * 60 + +mm;
  if (+hh > 14 || +mm > 59) return null;
  return sign === "-" ? -mins : mins;
}

/**
 * Build the UTC instant for a wall-clock time observed at a given offset.
 * If `offsetMin` is null the wall-clock is treated AS IF UTC — a deterministic
 * choice (not the true instant, but identical on every machine, and ordering is
 * the only consumer of `takenAt` for offset-less media; the day is carried by
 * `localDate`, which is unaffected).
 */
function instantFromWallClock(w: WallClock, offsetMin: number | null): string {
  const utcMs =
    Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) -
    (offsetMin ?? 0) * 60_000;
  return new Date(utcMs).toISOString();
}

/** Wall-clock components of an instant as observed at a given offset. */
function wallClockAtOffset(instant: Date, offsetMin: number): WallClock {
  const shifted = new Date(instant.getTime() + offsetMin * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/**
 * Parse an Apple QuickTime `creationdate` (e.g. "2026-06-22T18:03:00+0100"),
 * which carries the local time AND its UTC offset, into an exact instant plus
 * the offset in minutes. The offset may lack a colon ("+0100").
 */
export function parseAppleCreationDate(
  raw: string
): { instant: string; tzOffsetMin: number | null } | null {
  const trimmed = raw.trim();
  const normalized = trimmed.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(normalized);
  const year = d.getUTCFullYear();
  if (isNaN(d.getTime()) || year < 1990 || year > 2100) return null;
  const offMatch = normalized.match(/(Z|[+-]\d{2}:\d{2})$/);
  const tzOffsetMin = offMatch ? parseTzOffset(offMatch[1]) : null;
  return { instant: d.toISOString(), tzOffsetMin };
}

/** Date from a filename pattern (date only, no time-of-day). */
function wallClockFromFilename(name: string): Pick<WallClock, "year" | "month" | "day"> | null {
  const m = name.match(
    /(?:^|\D)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?=\D|$)/
  );
  if (!m) return null;
  const w: WallClock = {
    year: +m[1],
    month: +m[2],
    day: +m[3],
    hour: 12,
    minute: 0,
    second: 0,
  };
  return isRealDate(w) ? w : null;
}

/** Parse a manual `YYYY-MM-DD` or `datetime-local` value into wall-clock parts. */
function parseManual(value: string): WallClock | null {
  const m = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const w: WallClock = {
    year: +m[1],
    month: +m[2],
    day: +m[3],
    hour: m[4] ? +m[4] : 12, // default noon so a bare date can't drift a day
    minute: m[5] ? +m[5] : 0,
    second: m[6] ? +m[6] : 0,
  };
  return isRealDate(w) ? w : null;
}

/**
 * Resolve the canonical capture date for one media item from provenance-tagged
 * inputs, trying sources in descending trust order. Pure and deterministic;
 * pass `nowMs` so the `upload_fallback` branch stays testable.
 */
export function resolveCaptureDate(
  input: CaptureDateInput,
  nowMs?: number
): CaptureDate {
  // 1. Manual entry — the user asserted it, so it wins.
  if (input.manual) {
    const w = parseManual(input.manual);
    if (w) {
      return {
        takenAt: instantFromWallClock(w, null),
        tzOffsetMin: null,
        localDate: localDateOf(w),
        source: "manual",
        confidence: "high",
      };
    }
  }

  // 2. Photo EXIF.
  if (input.exifDateTimeOriginal) {
    const w = parseExifWallClock(input.exifDateTimeOriginal);
    if (w) {
      const offsetMin = parseTzOffset(input.exifOffsetTimeOriginal);
      if (offsetMin !== null) {
        // True instant + tz: local day is unambiguous.
        return {
          takenAt: instantFromWallClock(w, offsetMin),
          tzOffsetMin: offsetMin,
          localDate: localDateOf(w),
          source: "exif_offset",
          confidence: "high",
        };
      }
      // Naive wall-clock: deterministic instant, day taken from components.
      return {
        takenAt: instantFromWallClock(w, null),
        tzOffsetMin: null,
        localDate: localDateOf(w),
        source: "exif",
        confidence: "medium",
      };
    }
  }

  // 3. Video container creation time.
  if (input.videoCreation) {
    const instant = new Date(input.videoCreation.instant);
    if (!isNaN(instant.getTime())) {
      const off = input.videoCreation.tzOffsetMin;
      const w = wallClockAtOffset(instant, off ?? 0);
      return {
        takenAt: instant.toISOString(),
        tzOffsetMin: off,
        localDate: localDateOf(w),
        source: "video_meta",
        // Apple gives a true local day (high); mvhd is UTC-only (medium).
        confidence: off !== null ? "high" : "medium",
      };
    }
  }

  // 4. Filename date (date only).
  if (input.filename) {
    const w = wallClockFromFilename(input.filename);
    if (w) {
      const full: WallClock = { ...w, hour: 12, minute: 0, second: 0 };
      return {
        takenAt: instantFromWallClock(full, null),
        tzOffsetMin: null,
        localDate: localDateOf(w),
        source: "filename",
        confidence: "low",
      };
    }
  }

  // 5. Filesystem mtime.
  if (input.fileLastModifiedMs != null && input.fileLastModifiedMs > 0) {
    const d = new Date(input.fileLastModifiedMs);
    if (!isNaN(d.getTime())) {
      const w = wallClockAtOffset(d, 0);
      return {
        takenAt: d.toISOString(),
        tzOffsetMin: null,
        localDate: localDateOf(w),
        source: "file_mtime",
        confidence: "low",
      };
    }
  }

  // 6. Nothing — stamp upload time so ordering still works.
  const now = new Date(nowMs ?? 0);
  const stamped = nowMs != null && !isNaN(now.getTime());
  return {
    takenAt: stamped ? now.toISOString() : null,
    tzOffsetMin: null,
    localDate: stamped ? localDateOf(wallClockAtOffset(now, 0)) : null,
    source: "upload_fallback",
    confidence: "low",
  };
}
