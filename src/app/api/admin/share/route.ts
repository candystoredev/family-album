import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function POST(request: Request) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { postId } = await request.json();
  if (!postId) {
    return NextResponse.json({ error: "postId required" }, { status: 400 });
  }

  // Verify post exists
  const post = await db.execute({
    sql: "SELECT id FROM posts WHERE id = ? LIMIT 1",
    args: [postId],
  });
  if (post.rows.length === 0) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const token = randomBytes(24).toString("base64url");
  const id = randomBytes(8).toString("hex");
  // 30-day expiry
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await db.execute({
    sql: `INSERT INTO post_share_links (id, token, post_id, expires_at) VALUES (?, ?, ?, ?)`,
    args: [id, token, postId, expiresAt],
  });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thehoecks.com";
  return NextResponse.json({ shareUrl: `${siteUrl}/share/${token}` });
}
