import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const PAGE_SIZE = 20;

interface FtsRow {
  post_id: string;
  rank: number;
}

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

export async function GET(request: NextRequest) {
  const r2PublicUrl = process.env.R2_PUBLIC_URL!;
  const q = request.nextUrl.searchParams.get("q")?.trim();
  const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0", 10);

  if (!q || q.length === 0) {
    return NextResponse.json({ posts: [], total: 0, hasMore: false });
  }

  // Sanitize query for FTS5: wrap each word in quotes to avoid syntax errors
  const safeQuery = q
    .replace(/['"]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `"${word}"`)
    .join(" ");

  if (!safeQuery) {
    return NextResponse.json({ posts: [], total: 0, hasMore: false });
  }

  // Count total matches
  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as total FROM posts_fts WHERE posts_fts MATCH ?`,
    args: [safeQuery],
  });
  const total = (countResult.rows[0] as unknown as { total: number }).total;

  if (total === 0) {
    return NextResponse.json({ posts: [], total: 0, hasMore: false });
  }

  // Get matching post IDs ranked by relevance
  const ftsResult = await db.execute({
    sql: `SELECT post_id, rank FROM posts_fts WHERE posts_fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?`,
    args: [safeQuery, PAGE_SIZE + 1, offset],
  });
  const ftsRows = ftsResult.rows as unknown as FtsRow[];

  const hasMore = ftsRows.length > PAGE_SIZE;
  const resultRows = ftsRows.slice(0, PAGE_SIZE);

  if (resultRows.length === 0) {
    return NextResponse.json({ posts: [], total, hasMore: false });
  }

  const postIds = resultRows.map((r) => r.post_id);
  const placeholders = postIds.map(() => "?").join(",");

  // Fetch full post data
  const postsResult = await db.execute({
    sql: `SELECT id, slug, title, body, date, type, photoset_layout
          FROM posts WHERE id IN (${placeholders})`,
    args: postIds,
  });
  const postMap = new Map<string, PostRow>();
  for (const row of postsResult.rows as unknown as PostRow[]) {
    postMap.set(row.id, row);
  }

  // Fetch media, tags, people in parallel
  const [mediaResult, tagsResult, peopleResult] = await Promise.all([
    db.execute({
      sql: `SELECT id, post_id, r2_key, thumbnail_r2_key, type, width, height, display_order
            FROM media WHERE post_id IN (${placeholders}) ORDER BY display_order`,
      args: postIds,
    }),
    db.execute({
      sql: `SELECT pt.post_id, t.name, t.slug
            FROM post_tags pt INNER JOIN tags t ON t.id = pt.tag_id
            WHERE pt.post_id IN (${placeholders})`,
      args: postIds,
    }),
    db.execute({
      sql: `SELECT pp.post_id, pe.name, pe.slug
            FROM post_people pp INNER JOIN people pe ON pe.id = pp.person_id
            WHERE pp.post_id IN (${placeholders})`,
      args: postIds,
    }),
  ]);

  // Group media by post
  const mediaByPost = new Map<string, MediaRow[]>();
  for (const m of mediaResult.rows as unknown as MediaRow[]) {
    const arr = mediaByPost.get(m.post_id) || [];
    arr.push(m);
    mediaByPost.set(m.post_id, arr);
  }

  // Group tags by post
  const tagsByPost = new Map<string, { name: string; slug: string }[]>();
  for (const t of tagsResult.rows as unknown as TagRow[]) {
    const arr = tagsByPost.get(t.post_id) || [];
    arr.push({ name: t.name, slug: t.slug });
    tagsByPost.set(t.post_id, arr);
  }

  // Group people by post
  const peopleByPost = new Map<string, { name: string; slug: string }[]>();
  for (const p of peopleResult.rows as unknown as PersonRow[]) {
    const arr = peopleByPost.get(p.post_id) || [];
    arr.push({ name: p.name, slug: p.slug });
    peopleByPost.set(p.post_id, arr);
  }

  // Assemble results in FTS rank order
  const posts = resultRows
    .map((fts) => {
      const post = postMap.get(fts.post_id);
      if (!post) return null;
      return {
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
          display_order: m.display_order,
        })),
        tags: tagsByPost.get(post.id) || [],
        people: peopleByPost.get(post.id) || [],
      };
    })
    .filter(Boolean);

  return NextResponse.json({ posts, total, hasMore });
}
