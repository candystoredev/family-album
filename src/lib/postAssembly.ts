import { db } from "./db";

/**
 * Shared "attach media/tags/people to posts" pipeline.
 *
 * Four read paths (SSR feed, /api/feed, /api/search, on-this-day) all take a set
 * of post ids, batch-fetch their media/tags/people with `IN (...)`, group the
 * rows by post, and build enriched post objects. This module centralizes that
 * batched enrichment so the risky bits — the R2 URL construction, media ordering
 * by `display_order`, and the parallel fetch — live in exactly one place. Each
 * caller keeps its own ordering/cursor/ranking/grouping concerns.
 *
 * Two historical drifts across the callers:
 *  - `display_order` on media objects: the API feed + search included it, SSR
 *    feed did not. Unified to ALWAYS include it (the client orders media by array
 *    position, which is already sorted by `display_order`, so the extra field is
 *    inert). On-this-day intentionally strips it back off in its own mapping.
 *  - video thumbnail fallback for a video with no `thumbnail_r2_key`: the feed
 *    paths use "" (a video URL used as a <video> poster renders black; PhotoGrid
 *    skips poster="" cleanly), search + on-this-day historically fell back to the
 *    media url. Preserved per-caller via `videoThumbnailFallback`.
 */

/**
 * Thumbnail fallback for a video row that has no `thumbnail_r2_key`:
 *  - "empty": thumbnailUrl "" (feed + /api/feed).
 *  - "self":  thumbnailUrl = the media url (search + on-this-day).
 * A non-video row with no thumbnail always falls back to the media url.
 */
export type VideoThumbnailFallback = "empty" | "self";

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

interface RelationRow {
  post_id: string;
  name: string;
  slug: string;
}

export interface AssembledMedia {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
  display_order: number;
}

export interface Relation {
  name: string;
  slug: string;
}

export interface PostRelations {
  mediaByPost: Map<string, AssembledMedia[]>;
  tagsByPost: Map<string, Relation[]>;
  peopleByPost: Map<string, Relation[]>;
}

export interface AttachOptions {
  /** Thumbnail fallback for videos with no thumbnail. Default "empty". */
  videoThumbnailFallback?: VideoThumbnailFallback;
  /** Fetch tags. Default true. */
  withTags?: boolean;
  /** Fetch people. Default true. */
  withPeople?: boolean;
}

/**
 * Build a single enriched media object. Pure — this is the exact URL
 * construction every caller shares, kept in one place so it can't drift again.
 */
export function buildMedia(
  m: MediaRow,
  r2PublicUrl: string,
  videoThumbnailFallback: VideoThumbnailFallback = "empty"
): AssembledMedia {
  const url = `${r2PublicUrl}/${m.r2_key}`;
  const noThumbFallback =
    m.type === "video" && videoThumbnailFallback === "empty" ? "" : url;
  return {
    id: m.id,
    type: m.type,
    url,
    thumbnailUrl: m.thumbnail_r2_key
      ? `${r2PublicUrl}/${m.thumbnail_r2_key}`
      : noThumbFallback,
    width: m.width,
    height: m.height,
    display_order: m.display_order,
  };
}

/**
 * Assemble enriched posts by attaching each post's media/tags/people from the
 * pre-built maps. Pure; preserves the input post order and each post's own
 * columns (spread verbatim). Posts with no relations get empty arrays.
 */
export function assemblePosts<T extends { id: string }>(
  posts: T[],
  relations: PostRelations
): (T & { media: AssembledMedia[]; tags: Relation[]; people: Relation[] })[] {
  return posts.map((post) => ({
    ...post,
    media: relations.mediaByPost.get(post.id) || [],
    tags: relations.tagsByPost.get(post.id) || [],
    people: relations.peopleByPost.get(post.id) || [],
  }));
}

/**
 * Batch-fetch media (always) and optionally tags/people for the given post ids
 * in a single parallel round trip, returning them grouped by post_id. Media is
 * ordered by `display_order`; each media row is built via {@link buildMedia}.
 */
export async function fetchPostRelations(
  postIds: string[],
  opts: AttachOptions = {}
): Promise<PostRelations> {
  const {
    videoThumbnailFallback = "empty",
    withTags = true,
    withPeople = true,
  } = opts;
  const r2PublicUrl = process.env.R2_PUBLIC_URL!;
  const placeholders = postIds.map(() => "?").join(",");

  const mediaP = db.execute({
    sql: `SELECT id, post_id, r2_key, thumbnail_r2_key, type, width, height, display_order
          FROM media WHERE post_id IN (${placeholders}) ORDER BY display_order`,
    args: postIds,
  });
  const tagsP = withTags
    ? db.execute({
        sql: `SELECT pt.post_id, t.name, t.slug
              FROM post_tags pt
              INNER JOIN tags t ON t.id = pt.tag_id
              WHERE pt.post_id IN (${placeholders})`,
        args: postIds,
      })
    : null;
  const peopleP = withPeople
    ? db.execute({
        sql: `SELECT pp.post_id, pe.name, pe.slug
              FROM post_people pp
              INNER JOIN people pe ON pe.id = pp.person_id
              WHERE pp.post_id IN (${placeholders})`,
        args: postIds,
      })
    : null;

  const [mediaResult, tagsResult, peopleResult] = await Promise.all([
    mediaP,
    tagsP,
    peopleP,
  ] as const);

  const mediaByPost = new Map<string, AssembledMedia[]>();
  for (const row of mediaResult.rows as unknown as MediaRow[]) {
    const arr = mediaByPost.get(row.post_id) || [];
    arr.push(buildMedia(row, r2PublicUrl, videoThumbnailFallback));
    mediaByPost.set(row.post_id, arr);
  }

  const tagsByPost = new Map<string, Relation[]>();
  if (tagsResult) {
    for (const row of tagsResult.rows as unknown as RelationRow[]) {
      const arr = tagsByPost.get(row.post_id) || [];
      arr.push({ name: row.name, slug: row.slug });
      tagsByPost.set(row.post_id, arr);
    }
  }

  const peopleByPost = new Map<string, Relation[]>();
  if (peopleResult) {
    for (const row of peopleResult.rows as unknown as RelationRow[]) {
      const arr = peopleByPost.get(row.post_id) || [];
      arr.push({ name: row.name, slug: row.slug });
      peopleByPost.set(row.post_id, arr);
    }
  }

  return { mediaByPost, tagsByPost, peopleByPost };
}

/**
 * Convenience wrapper for the "spread the post, attach media/tags/people"
 * shape shared by the SSR feed, /api/feed and /api/search. Returns enriched
 * posts in the same order as the input.
 */
export async function attachMediaTagsPeople<T extends { id: string }>(
  posts: T[],
  opts: AttachOptions = {}
): Promise<(T & { media: AssembledMedia[]; tags: Relation[]; people: Relation[] })[]> {
  if (posts.length === 0) return [];
  const relations = await fetchPostRelations(
    posts.map((p) => p.id),
    opts
  );
  return assemblePosts(posts, relations);
}
