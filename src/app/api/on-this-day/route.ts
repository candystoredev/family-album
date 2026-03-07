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
  // Using strftime to extract month and day from the date column
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");

  const result = await db.execute({
    sql: `SELECT p.id, p.slug, p.title, p.date
          FROM posts p
          WHERE strftime('%m', p.date) = ? AND strftime('%d', p.date) = ?
            AND strftime('%Y', p.date) != ?
          ORDER BY p.date DESC
          LIMIT 5`,
    args: [mm, dd, String(currentYear)],
  });

  const posts = await Promise.all(
    (result.rows as unknown as { id: string; slug: string; title: string | null; date: string }[]).map(
      async (post) => {
        // Get first media thumbnail
        const mediaResult = await db.execute({
          sql: `SELECT thumbnail_r2_key, r2_key FROM media WHERE post_id = ? ORDER BY display_order LIMIT 1`,
          args: [post.id],
        });
        const media = mediaResult.rows[0] as unknown as { thumbnail_r2_key: string | null; r2_key: string } | undefined;
        return {
          slug: post.slug,
          title: post.title,
          date: post.date,
          thumbnailUrl: media
            ? `${r2PublicUrl}/${media.thumbnail_r2_key || media.r2_key}`
            : null,
        };
      }
    )
  );

  return NextResponse.json({ posts });
}
