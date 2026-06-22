import { db } from "./db";

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
  const result = await db.execute({
    sql: `SELECT p.id, p.slug, p.title, p.body, p.date, p.photoset_layout
          FROM posts p
          WHERE strftime('%m', p.date) = ? AND strftime('%d', p.date) = ?
            AND CAST(strftime('%Y', p.date) AS INTEGER) < ?
          ORDER BY p.date DESC
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
  }[];

  // Pick up to `limit` posts, max `maxPerYear` from any single year.
  const selected: typeof allRows = [];
  const yearCount = new Map<string, number>();
  for (const row of allRows) {
    if (selected.length >= limit) break;
    const year = row.date.slice(0, 4);
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
      photosetLayout: post.photoset_layout,
      thumbnailUrl: media[0]?.thumbnailUrl || null,
      media,
    };
  });
}
