/**
 * Temporal-neighbour tag suggestion (Part 2, Workstream B).
 *
 * A new post whose photos were captured close in time to an existing tagged
 * post almost certainly shares its context (e.g. a second batch of Cornwall
 * photos uploaded a day after the first). We suggest the neighbour's tags.
 *
 * This module holds only the pure window-bounds computation so it's testable
 * without a DB; the range query itself lives in the suggest-tags route.
 */

/** How far either side of a photo's capture instant a "temporal neighbour" may fall. */
export const TEMPORAL_WINDOW_HOURS = 48;

/**
 * Compute the [start, end] ISO-8601 UTC bounds of the ±window around a capture
 * instant, or null when `takenAt` isn't a parseable date. The bounds are meant
 * to be compared as TEXT against the feed's effective-instant expression
 * (order.ts ORDER_KEY_SQL) — ISO-8601 UTC strings sort correctly as text, so a
 * lexical BETWEEN is a correct range test. (Legacy `posts.date` normalises to a
 * second-precision `…Z` while these bounds carry milliseconds; the sub-second
 * skew at the very edge of a 48h window is immaterial.)
 */
export function temporalWindowBounds(
  takenAt: string,
  windowHours: number = TEMPORAL_WINDOW_HOURS
): { start: string; end: string } | null {
  const t = new Date(takenAt);
  if (isNaN(t.getTime())) return null;
  const ms = windowHours * 3_600_000;
  return {
    start: new Date(t.getTime() - ms).toISOString(),
    end: new Date(t.getTime() + ms).toISOString(),
  };
}
