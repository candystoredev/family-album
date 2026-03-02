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
  const tagSlug = request.nextUrl.searchParams.get("tag");
  const personSlug = request.nextUrl.searchParams.get("person");
  const albumSlug = request.nextUrl.searchParams.get("album");

  // Resolve filter to ID if present
  let filterJoin = "";
  let filterArgs: (string | number)[] = [];

  if (tagSlug) {
    const tag = await db.execute({
      sql: "SELECT id FROM tags WHERE slug = ?",
      args: [tagSlug],
    });
    if (tag.rows.length === 0) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }
    filterJoin = "INNER JOIN post_tags pt ON pt.post_id = p.id AND pt.tag_id = ?";
    filterArgs = [tag.rows[0].id as string];
  } else if (personSlug) {
    const person = await db.execute({
      sql: "SELECT id FROM people WHERE slug = ?",
      args: [personSlug],
    });
    if (person.rows.length === 0) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }
    filterJoin = "INNER JOIN post_people pp ON pp.post_id = p.id AND pp.person_id = ?";
    filterArgs = [person.rows[0].id as string];
  } else if (albumSlug) {
    const album = await db.execute({
      sql: "SELECT id FROM albums WHERE slug = ?",
      args: [albumSlug],
    });
    if (album.rows.length === 0) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    filterJoin = "INNER JOIN post_albums pa ON pa.post_id = p.id AND pa.album_id = ?";
    filterArgs = [album.rows[0].id as string];
  }

  let posts: PostRow[];

  if (cursor) {
    const parsed = decodeCursor(cursor);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
    const result = await db.execute({
      sql: `SELECT p.id, p.slug, p.title, p.body, p.date, p.type, p.photoset_layout
            FROM posts p
            ${filterJoin}
            WHERE (p.date < ? OR (p.date = ? AND p.id < ?))
            ORDER BY p.date DESC, p.id DESC
            LIMIT ?`,
      args: [...filterArgs, parsed.date, parsed.date, parsed.id, PAGE_SIZE + 1],
    });
    posts = result.rows as unknown as PostRow[];
  } else {
    const result = await db.execute({
      sql: `SELECT p.id, p.slug, p.title, p.body, p.date, p.type, p.photoset_layout
            FROM posts p
            ${filterJoin}
            ORDER BY p.date DESC, p.id DESC
            LIMIT ?`,
      args: [...filterArgs, PAGE_SIZE + 1],
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

  // Fetch tags for these posts
  const tagsResult = await db.execute({
    sql: `SELECT pt.post_id, t.name, t.slug
          FROM post_tags pt
          INNER JOIN tags t ON t.id = pt.tag_id
          WHERE pt.post_id IN (${placeholders})`,
    args: postIds,
  });
  const tagRows = tagsResult.rows as unknown as TagRow[];

  // Fetch people for these posts
  const peopleResult = await db.execute({
    sql: `SELECT pp.post_id, pe.name, pe.slug
          FROM post_people pp
          INNER JOIN people pe ON pe.id = pp.person_id
          WHERE pp.post_id IN (${placeholders})`,
    args: postIds,
  });
  const personRows = peopleResult.rows as unknown as PersonRow[];

  // Group media by post_id
  const mediaByPost = new Map<string, MediaRow[]>();
  for (const m of mediaRows) {
    const arr = mediaByPost.get(m.post_id) || [];
    arr.push(m);
    mediaByPost.set(m.post_id, arr);
  }

  // Group tags by post_id
  const tagsByPost = new Map<string, { name: string; slug: string }[]>();
  for (const t of tagRows) {
    const arr = tagsByPost.get(t.post_id) || [];
    arr.push({ name: t.name, slug: t.slug });
    tagsByPost.set(t.post_id, arr);
  }

  // Group people by post_id
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
      display_order: m.display_order,
    })),
    tags: tagsByPost.get(post.id) || [],
    people: peopleByPost.get(post.id) || [],
  }));

  return NextResponse.json({ posts: postsWithMedia, nextCursor });
}
