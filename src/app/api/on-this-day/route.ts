import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ posts: [] }, { status: 401 });

  const month = req.nextUrl.searchParams.get("month");
  const day = req.nextUrl.searchParams.get("day");

  if (!month || !day) return NextResponse.json({ posts: [] });

  const r2PublicUrl = process.env.R2_PUBLIC_URL!;
  const currentYear = new Date().getFullYear();

  // Find posts from previous years that match today's month and day
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");

  // Fetch up to 10 candidates so we can enforce diversity (2+ different years, return 3)
  const result = await db.execute({
    sql: `SELECT p.id, p.slug, p.title, p.body, p.date, p.photoset_layout
          FROM posts p
          WHERE strftime('%m', p.date) = ? AND strftime('%d', p.date) = ?
            AND strftime('%Y', p.date) != ?
          ORDER BY p.date DESC
          LIMIT 10`,
    args: [mm, dd, String(currentYear)],
  });

  // Pick up to 3 posts, max 2 from any single year
  const allRows = result.rows as unknown as {
    id: string;
    slug: string;
    title: string | null;
    body: string | null;
    date: string;
    photoset_layout: string | null;
  }[];
  let selected: typeof allRows = [];
  if (allRows.length > 0) {
    const yearCount = new Map<string, number>();
    for (const row of allRows) {
      const year = row.date.slice(0, 4);
      const count = yearCount.get(year) || 0;
      if (count < 2 && selected.length < 3) {
        selected.push(row);
        yearCount.set(year, count + 1);
      }
    }
  }

  // Fetch all media for selected posts
  const postIds = selected.map((p) => p.id);
  let mediaByPostId = new Map<
    string,
    { id: string; type: string; url: string; thumbnailUrl: string; width: number | null; height: number | null }[]
  >();

  if (postIds.length > 0) {
    const placeholders = postIds.map(() => "?").join(",");
    const mediaResult = await db.execute({
      sql: `SELECT id, post_id, r2_key, thumbnail_r2_key, type, width, height
            FROM media
            WHERE post_id IN (${placeholders})
            ORDER BY display_order`,
      args: postIds,
    });

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
  }

  const posts = selected.map((post) => {
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

  return NextResponse.json({ posts });
}
