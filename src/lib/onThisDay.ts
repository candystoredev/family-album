import { db } from "./db";
import { ORDER_KEY_SQL, EFF_DAY_SQL } from "./order";

export interface OnThisDayMedia {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
}

export interface OnThisDayPost {
  slug: string;
  title: string | null;
  body: string | null;
  date: string;
  /** Effective capture day (`local_date` ?? legacy day), tz-independent
   *  `YYYY-MM-DD`. Always populated — feed formatDisplayDate/year-math with
   *  this instead of `new Date(date)` to avoid day-shift bugs (Phase 12b). */
  localDate: string;
  photosetLayout: string | null;
  thumbnailUrl: string | null;
  media: OnThisDayMedia[];
}

/**
 * Find memories from previous years that fall on the given calendar date
 * (month/day), with at most `maxPerYear` from any single year for variety.
 *
 * Shared by three surfaces with different limits:
 *  - homepage "On this day" teaser + daily push notifier → default 3 (curated tease)
 *  - the dedicated /today page → 6 (a fuller look back, still varied across years)
 */
export async function getMemoriesForDate(
  month: number,
  day: number,
  currentYear: number = new Date().getFullYear(),
  limit: number = 3,
  maxPerYear: number = 2
): Promise<OnThisDayPost[]> {
  const r2PublicUrl = process.env.R2_PUBLIC_URL!;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");

  // Fetch a generous candidate pool so we can enforce per-year diversity
  // before trimming to `limit`. Only previous years (strictly < currentYear) —
  // so a date-pinned page never shows posts from years after the pinned day,
  // which would otherwise read as "-2 years ago".
  // Match on the effective capture day (local_date ?? legacy day) so "on this
  // day" follows true capture, not upload/legacy date (Phase 10.2b).
  const result = await db.execute({
    sql: `SELECT p.id, p.slug, p.title, p.body, p.date, p.photoset_layout,
                 ${EFF_DAY_SQL} AS eff_day
          FROM posts p
          WHERE substr(${EFF_DAY_SQL}, 6, 2) = ? AND substr(${EFF_DAY_SQL}, 9, 2) = ?
            AND CAST(substr(${EFF_DAY_SQL}, 1, 4) AS INTEGER) < ?
          ORDER BY ${ORDER_KEY_SQL} DESC
          LIMIT 60`,
    args: [mm, dd, currentYear],
  });

  const allRows = result.rows as unknown as {
    id: string;
    slug: string;
    title: string | null;
    body: string | null;
    date: string;
    photoset_layout: string | null;
    eff_day: string;
  }[];

  // Pick up to `limit` posts, max `maxPerYear` from any single year.
  const selected: typeof allRows = [];
  const yearCount = new Map<string, number>();
  for (const row of allRows) {
    if (selected.length >= limit) break;
    const year = row.eff_day.slice(0, 4);
    const count = yearCount.get(year) || 0;
    if (count < maxPerYear) {
      selected.push(row);
      yearCount.set(year, count + 1);
    }
  }

  if (selected.length === 0) return [];

  // Fetch all media for selected posts.
  const postIds = selected.map((p) => p.id);
  const placeholders = postIds.map(() => "?").join(",");
  const mediaResult = await db.execute({
    sql: `SELECT id, post_id, r2_key, thumbnail_r2_key, type, width, height
          FROM media
          WHERE post_id IN (${placeholders})
          ORDER BY display_order`,
    args: postIds,
  });

  const mediaByPostId = new Map<string, OnThisDayMedia[]>();
  for (const row of mediaResult.rows) {
    const m = row as unknown as {
      id: string;
      post_id: string;
      r2_key: string;
      thumbnail_r2_key: string | null;
      type: string;
      width: number | null;
      height: number | null;
    };
    const arr = mediaByPostId.get(m.post_id) || [];
    arr.push({
      id: m.id,
      type: m.type,
      url: `${r2PublicUrl}/${m.r2_key}`,
      thumbnailUrl: m.thumbnail_r2_key
        ? `${r2PublicUrl}/${m.thumbnail_r2_key}`
        : `${r2PublicUrl}/${m.r2_key}`,
      width: m.width,
      height: m.height,
    });
    mediaByPostId.set(m.post_id, arr);
  }

  return selected.map((post) => {
    const media = mediaByPostId.get(post.id) || [];
    return {
      slug: post.slug,
      title: post.title,
      body: post.body,
      date: post.date,
      localDate: post.eff_day,
      photosetLayout: post.photoset_layout,
      thumbnailUrl: media[0]?.thumbnailUrl || null,
      media,
    };
  });
}
