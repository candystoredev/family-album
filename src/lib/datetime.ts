const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Format a capture date for display (Phase 10.2c). Prefers the tz-independent
 * `local_date` (`YYYY-MM-DD`) so the shown day is the capture-local day and a
 * timezone can never shift it; falls back to the legacy date string. Returns
 * e.g. "Jun 20, 2026" (or "June 20, 2026" when `long`).
 */
export function formatDisplayDate(
  legacyDate: string,
  localDate?: string | null,
  opts?: { long?: boolean }
): string {
  const months = opts?.long ? MONTHS_LONG : MONTHS_SHORT;
  if (localDate && /^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    const [y, m, d] = localDate.split("-").map(Number);
    if (m >= 1 && m <= 12) return `${months[m - 1]} ${d}, ${y}`;
  }
  const dt = new Date(legacyDate);
  if (isNaN(dt.getTime())) return legacyDate;
  return dt.toLocaleDateString("en-US", {
    year: "numeric",
    month: opts?.long ? "long" : "short",
    day: "numeric",
  });
}

/** Date sources that mean "we guessed" — show an estimated-date affordance. */
const ESTIMATED_SOURCES = new Set(["filename", "file_mtime", "upload_fallback"]);

/** True when the post's date came from a fallback, not real capture metadata. */
export function isEstimatedDate(dateSource?: string | null): boolean {
  return !!dateSource && ESTIMATED_SOURCES.has(dateSource);
}

/** Human phrasing of a `date_source`, for the upload/edit date affordances. */
export function captureSourceLabel(source?: string | null): string {
  switch (source) {
    case "exif_offset":
    case "exif":
      return "from photo metadata";
    case "video_meta":
      return "from video metadata";
    case "filename":
      return "estimated from the filename";
    case "file_mtime":
      return "estimated from the file's modified time";
    case "manual":
      return "set manually";
    case "upload_fallback":
      return "from the upload time";
    default:
      return "from the original import";
  }
}

/** Current date parts in a given IANA timezone. */
export function zonedNow(timeZone: string): {
  date: string; // YYYY-MM-DD
  hour: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    date: `${year}-${month}-${day}`,
    hour: Number(get("hour")),
    month: Number(month),
    day: Number(day),
  };
}
