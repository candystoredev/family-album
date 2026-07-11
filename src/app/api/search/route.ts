import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { attachMediaTagsPeople } from "@/lib/postAssembly";

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

export async function GET(request: NextRequest) {
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

  // Reassemble in FTS rank order, dropping any ids missing from posts. Search
  // uses the "self" video-thumbnail fallback (video with no thumbnail → its own
  // url), preserving this route's historical behavior.
  const orderedPosts = resultRows
    .map((fts) => postMap.get(fts.post_id))
    .filter((p): p is PostRow => p !== undefined);
  const posts = await attachMediaTagsPeople(orderedPosts, {
    videoThumbnailFallback: "self",
  });

  return NextResponse.json({ posts, total, hasMore });
}
