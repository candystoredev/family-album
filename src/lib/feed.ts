import { db } from "./db";

const PAGE_SIZE = 20;

interface PostRow {
  id: string;
  slug: string;
  title: string | null;
  body: string | null;
  date: string;
  type: string;
  photoset_layout: string | null;
}

interface MediaRow {
  id: string;
  post_id: string;
  r2_key: string;
  thumbnail_r2_key: string | null;
  type: string;
  width: number | null;
  height: number | null;
  display_order: number;
}

interface TagRow {
  post_id: string;
  name: string;
  slug: string;
}

interface PersonRow {
  post_id: string;
  name: string;
  slug: string;
}

function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`).toString("base64url");
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
  const r2PublicUrl = process.env.R2_PUBLIC_URL!;

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
    dateWhere = "WHERE p.date >= ? AND p.date < ?";
    dateArgs.push(startDate, endDate);
  }

  const result = await db.execute({
    sql: `SELECT p.id, p.slug, p.title, p.body, p.date, p.type, p.photoset_layout
          FROM posts p
          ${filterJoin}
          ${dateWhere}
          ORDER BY p.date ${orderDir}, p.id ${orderDir} LIMIT ?`,
    args: [...filterArgs, ...dateArgs, PAGE_SIZE + 1],
  });

  let posts = result.rows as unknown as PostRow[];

  let nextCursor: string | null = null;
  if (posts.length > PAGE_SIZE) {
    posts = posts.slice(0, PAGE_SIZE);
    const last = posts[posts.length - 1];
    nextCursor = encodeCursor(last.date, last.id);
  }

  if (posts.length === 0) return { posts: [], nextCursor: null };

  // Fetch all media for these posts in one query
  const postIds = posts.map((p) => p.id);
  const placeholders = postIds.map(() => "?").join(",");

  const [mediaResult, tagsResult, peopleResult] = await Promise.all([
    db.execute({
      sql: `SELECT id, post_id, r2_key, thumbnail_r2_key, type, width, height, display_order
            FROM media WHERE post_id IN (${placeholders}) ORDER BY display_order`,
      args: postIds,
    }),
    db.execute({
      sql: `SELECT pt.post_id, t.name, t.slug
            FROM post_tags pt
            INNER JOIN tags t ON t.id = pt.tag_id
            WHERE pt.post_id IN (${placeholders})`,
      args: postIds,
    }),
    db.execute({
      sql: `SELECT pp.post_id, pe.name, pe.slug
            FROM post_people pp
            INNER JOIN people pe ON pe.id = pp.person_id
            WHERE pp.post_id IN (${placeholders})`,
      args: postIds,
    }),
  ]);

  const mediaRows = mediaResult.rows as unknown as MediaRow[];
  const tagRows = tagsResult.rows as unknown as TagRow[];
  const personRows = peopleResult.rows as unknown as PersonRow[];

  const mediaByPost = new Map<string, MediaRow[]>();
  for (const m of mediaRows) {
    const arr = mediaByPost.get(m.post_id) || [];
    arr.push(m);
    mediaByPost.set(m.post_id, arr);
  }

  const tagsByPost = new Map<string, { name: string; slug: string }[]>();
  for (const t of tagRows) {
    const arr = tagsByPost.get(t.post_id) || [];
    arr.push({ name: t.name, slug: t.slug });
    tagsByPost.set(t.post_id, arr);
  }

  const peopleByPost = new Map<string, { name: string; slug: string }[]>();
  for (const p of personRows) {
    const arr = peopleByPost.get(p.post_id) || [];
    arr.push({ name: p.name, slug: p.slug });
    peopleByPost.set(p.post_id, arr);
  }

  const postsWithMedia = posts.map((post) => ({
    ...post,
    media: (mediaByPost.get(post.id) || []).map((m) => ({
      id: m.id,
      type: m.type,
      url: `${r2PublicUrl}/${m.r2_key}`,
      thumbnailUrl: m.thumbnail_r2_key
        ? `${r2PublicUrl}/${m.thumbnail_r2_key}`
        : `${r2PublicUrl}/${m.r2_key}`,
      width: m.width,
      height: m.height,
    })),
    tags: tagsByPost.get(post.id) || [],
    people: peopleByPost.get(post.id) || [],
  }));

  return { posts: postsWithMedia, nextCursor };
}

export async function getImessageRecipients(): Promise<string> {
  const result = await db.execute({
    sql: `SELECT value FROM site_settings WHERE key = ?`,
    args: ["imessage_recipients"],
  });
  return result.rows.length > 0 ? (result.rows[0].value as string) : "";
}
