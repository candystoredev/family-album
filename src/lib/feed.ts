import { db } from "./db";
import { ORDER_KEY_SQL, EFF_DAY_SQL } from "./order";
import { attachMediaTagsPeople } from "./postAssembly";

const PAGE_SIZE = 20;

interface PostRow {
  id: string;
  slug: string;
  title: string | null;
  body: string | null;
  date: string;
  type: string;
  photoset_layout: string | null;
  /** Capture-local day + how the date was derived, for display (10.2c). */
  local_date: string | null;
  date_source: string | null;
  /** Effective ordering key (taken_at ?? normalized date); also the cursor. */
  order_key: string;
}

function encodeCursor(orderKey: string, id: string): string {
  return Buffer.from(`${orderKey}|${id}`).toString("base64url");
}

export interface FeedFilter {
  tagId?: string;
  personId?: string;
  albumId?: string;
  year?: number;
  month?: number;
}

/**
 * Fetch a page of posts for server-side rendering.
 * Supports optional filtering by tag, person, album, or year/month.
 * Month pages use oldest-first ordering.
 */
export async function getInitialFeed(filter?: FeedFilter) {
  let filterJoin = "";
  const filterArgs: (string | number)[] = [];
  let dateWhere = "";
  const dateArgs: string[] = [];

  if (filter?.tagId) {
    filterJoin =
      "INNER JOIN post_tags pt ON pt.post_id = p.id AND pt.tag_id = ?";
    filterArgs.push(filter.tagId);
  } else if (filter?.personId) {
    filterJoin =
      "INNER JOIN post_people pp ON pp.post_id = p.id AND pp.person_id = ?";
    filterArgs.push(filter.personId);
  } else if (filter?.albumId) {
    filterJoin =
      "INNER JOIN post_albums pa ON pa.post_id = p.id AND pa.album_id = ?";
    filterArgs.push(filter.albumId);
  }

  const isOldestFirst = !!(filter?.year && filter?.month);
  const orderDir = isOldestFirst ? "ASC" : "DESC";

  if (filter?.year && filter?.month) {
    const startDate = `${filter.year}-${String(filter.month).padStart(2, "0")}-01`;
    const nextMonth = filter.month === 12 ? 1 : filter.month + 1;
    const nextYear = filter.month === 12 ? filter.year + 1 : filter.year;
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
    dateWhere = `WHERE ${EFF_DAY_SQL} >= ? AND ${EFF_DAY_SQL} < ?`;
    dateArgs.push(startDate, endDate);
  }

  const result = await db.execute({
    sql: `SELECT p.id, p.slug, p.title, p.body, p.date, p.type, p.photoset_layout,
                 p.local_date, p.date_source, ${ORDER_KEY_SQL} AS order_key
          FROM posts p
          ${filterJoin}
          ${dateWhere}
          ORDER BY order_key ${orderDir}, p.id ${orderDir} LIMIT ?`,
    args: [...filterArgs, ...dateArgs, PAGE_SIZE + 1],
  });

  let posts = result.rows as unknown as PostRow[];

  let nextCursor: string | null = null;
  if (posts.length > PAGE_SIZE) {
    posts = posts.slice(0, PAGE_SIZE);
    const last = posts[posts.length - 1];
    nextCursor = encodeCursor(last.order_key, last.id);
  }

  if (posts.length === 0) return { posts: [], nextCursor: null };

  // Enrich with media/tags/people. "empty" video-thumbnail fallback: a video URL
  // used as a <video> poster renders black; PhotoGrid skips poster="" cleanly.
  const postsWithMedia = await attachMediaTagsPeople(posts, {
    videoThumbnailFallback: "empty",
  });

  return { posts: postsWithMedia, nextCursor };
}

export async function getImessageRecipients(): Promise<string> {
  const result = await db.execute({
    sql: `SELECT value FROM site_settings WHERE key = ?`,
    args: ["imessage_recipients"],
  });
  return result.rows.length > 0 ? (result.rows[0].value as string) : "";
}
