import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ media: [] }, { status: 401 });

  const body = await req.json();
  const mediaIds = body.mediaIds as string[];

  if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
    return NextResponse.json({ media: [] });
  }

  // Limit to 200 to prevent abuse
  const ids = mediaIds.slice(0, 200);
  const r2PublicUrl = process.env.R2_PUBLIC_URL!;
  const placeholders = ids.map(() => "?").join(",");

  const result = await db.execute({
    sql: `SELECT m.id, m.r2_key, m.thumbnail_r2_key, m.type, m.width, m.height,
                 p.slug AS post_slug, p.title AS post_title, p.date AS post_date
          FROM media m
          INNER JOIN posts p ON p.id = m.post_id
          WHERE m.id IN (${placeholders})
          ORDER BY p.date DESC`,
    args: ids,
  });

  const media = (
    result.rows as unknown as {
      id: string;
      r2_key: string;
      thumbnail_r2_key: string | null;
      type: string;
      width: number | null;
      height: number | null;
      post_slug: string;
      post_title: string | null;
      post_date: string;
    }[]
  ).map((row) => ({
    id: row.id,
    url: `${r2PublicUrl}/${row.r2_key}`,
    thumbnailUrl: row.thumbnail_r2_key
      ? `${r2PublicUrl}/${row.thumbnail_r2_key}`
      : `${r2PublicUrl}/${row.r2_key}`,
    type: row.type,
    width: row.width,
    height: row.height,
    postSlug: row.post_slug,
    postTitle: row.post_title,
    postDate: row.post_date,
  }));

  return NextResponse.json({ media });
}
