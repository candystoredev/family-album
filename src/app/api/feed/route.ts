import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

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

/**
 * Cursor format: base64(date + "|" + id)
 * Using (date, id) as cursor pair handles same-timestamp posts correctly.
 */
function decodeCursor(cursor: string): { date: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString();
    const sep = decoded.indexOf("|");
    if (sep === -1) return null;
    return { date: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`).toString("base64url");
}

export async function GET(request: NextRequest) {
  const r2PublicUrl = process.env.R2_PUBLIC_URL!;
  const cursor = request.nextUrl.searchParams.get("cursor");

  let posts: PostRow[];

  if (cursor) {
    const parsed = decodeCursor(cursor);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
    const result = await db.execute({
      sql: `SELECT id, slug, title, body, date, type, photoset_layout
            FROM posts
            WHERE date < ? OR (date = ? AND id < ?)
            ORDER BY date DESC, id DESC
            LIMIT ?`,
      args: [parsed.date, parsed.date, parsed.id, PAGE_SIZE + 1],
    });
    posts = result.rows as unknown as PostRow[];
  } else {
    const result = await db.execute({
      sql: `SELECT id, slug, title, body, date, type, photoset_layout
            FROM posts
            ORDER BY date DESC, id DESC
            LIMIT ?`,
      args: [PAGE_SIZE + 1],
    });
    posts = result.rows as unknown as PostRow[];
  }

  // Check if there's a next page
  let nextCursor: string | null = null;
  if (posts.length > PAGE_SIZE) {
    posts = posts.slice(0, PAGE_SIZE);
    const last = posts[posts.length - 1];
    nextCursor = encodeCursor(last.date, last.id);
  }

  if (posts.length === 0) {
    return NextResponse.json({ posts: [], nextCursor: null });
  }

  // Fetch all media for these posts in one query
  const postIds = posts.map((p) => p.id);
  const placeholders = postIds.map(() => "?").join(",");
  const mediaResult = await db.execute({
    sql: `SELECT id, post_id, r2_key, thumbnail_r2_key, type, width, height, display_order
          FROM media WHERE post_id IN (${placeholders}) ORDER BY display_order`,
    args: postIds,
  });
  const mediaRows = mediaResult.rows as unknown as MediaRow[];

  // Group media by post_id
  const mediaByPost = new Map<string, MediaRow[]>();
  for (const m of mediaRows) {
    const arr = mediaByPost.get(m.post_id) || [];
    arr.push(m);
    mediaByPost.set(m.post_id, arr);
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
      display_order: m.display_order,
    })),
  }));

  return NextResponse.json({ posts: postsWithMedia, nextCursor });
}
