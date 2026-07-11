import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ORDER_KEY_SQL, EFF_DAY_SQL } from "@/lib/order";
import { attachMediaTagsPeople } from "@/lib/postAssembly";

const PAGE_SIZE = 20;

interface PostRow {
  id: string;
  slug: string;
  title: string | null;
  body: string | null;
  date: string;
  type: string;
  photoset_layout: string | null;
  local_date: string | null;
  date_source: string | null;
  order_key: string;
}

/**
 * Cursor format: base64(orderKey + "|" + id), where orderKey is the effective
 * ordering value (taken_at ?? normalized legacy date — see lib/order.ts). The
 * (orderKey, id) pair handles same-instant posts correctly.
 */
function decodeCursor(cursor: string): { orderKey: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString();
    const sep = decoded.indexOf("|");
    if (sep === -1) return null;
    return { orderKey: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

function encodeCursor(orderKey: string, id: string): string {
  return Buffer.from(`${orderKey}|${id}`).toString("base64url");
}

export async function GET(request: NextRequest) {
  const cursor = request.nextUrl.searchParams.get("cursor");
  const tagSlug = request.nextUrl.searchParams.get("tag");
  const personSlug = request.nextUrl.searchParams.get("person");
  const albumSlug = request.nextUrl.searchParams.get("album");
  const yearParam = request.nextUrl.searchParams.get("year");
  const monthParam = request.nextUrl.searchParams.get("month");

  // Month pages use oldest-first ordering
  const isOldestFirst = !!(yearParam && monthParam);

  // Resolve filter to ID if present
  let filterJoin = "";
  let filterArgs: (string | number)[] = [];
  let dateWhere = "";
  const dateArgs: string[] = [];

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

  // Year/month date range filter
  if (yearParam && monthParam) {
    const year = parseInt(yearParam, 10);
    const month = parseInt(monthParam, 10);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "Invalid year/month" }, { status: 400 });
    }
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    // Calculate end date (first day of next month)
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
    dateWhere = `AND ${EFF_DAY_SQL} >= ? AND ${EFF_DAY_SQL} < ?`;
    dateArgs.push(startDate, endDate);
  }

  const orderDir = isOldestFirst ? "ASC" : "DESC";
  const cursorOp = isOldestFirst ? ">" : "<";

  let posts: PostRow[];

  if (cursor) {
    const parsed = decodeCursor(cursor);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
    const result = await db.execute({
      sql: `SELECT p.id, p.slug, p.title, p.body, p.date, p.type, p.photoset_layout,
                   p.local_date, p.date_source, ${ORDER_KEY_SQL} AS order_key
            FROM posts p
            ${filterJoin}
            WHERE (${ORDER_KEY_SQL} ${cursorOp} ? OR (${ORDER_KEY_SQL} = ? AND p.id ${cursorOp} ?))
            ${dateWhere}
            ORDER BY order_key ${orderDir}, p.id ${orderDir}
            LIMIT ?`,
      args: [...filterArgs, parsed.orderKey, parsed.orderKey, parsed.id, ...dateArgs, PAGE_SIZE + 1],
    });
    posts = result.rows as unknown as PostRow[];
  } else {
    const result = await db.execute({
      sql: `SELECT p.id, p.slug, p.title, p.body, p.date, p.type, p.photoset_layout,
                   p.local_date, p.date_source, ${ORDER_KEY_SQL} AS order_key
            FROM posts p
            ${filterJoin}
            WHERE 1=1 ${dateWhere}
            ORDER BY order_key ${orderDir}, p.id ${orderDir}
            LIMIT ?`,
      args: [...filterArgs, ...dateArgs, PAGE_SIZE + 1],
    });
    posts = result.rows as unknown as PostRow[];
  }

  // Check if there's a next page
  let nextCursor: string | null = null;
  if (posts.length > PAGE_SIZE) {
    posts = posts.slice(0, PAGE_SIZE);
    const last = posts[posts.length - 1];
    nextCursor = encodeCursor(last.order_key, last.id);
  }

  if (posts.length === 0) {
    return NextResponse.json({ posts: [], nextCursor: null });
  }

  // Enrich with media/tags/people in one parallel round trip. "empty"
  // video-thumbnail fallback: a video URL used as a <video> poster renders
  // black; PhotoGrid skips poster="" cleanly.
  const postsWithMedia = await attachMediaTagsPeople(posts, {
    videoThumbnailFallback: "empty",
  });

  return NextResponse.json({ posts: postsWithMedia, nextCursor });
}
