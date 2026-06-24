import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { baseUrlFromRequest } from "@/lib/baseUrl";

export async function POST(request: Request) {
  try {
    const { postId } = await request.json();
    if (!postId) {
      return NextResponse.json({ error: "postId required" }, { status: 400 });
    }

    const post = await db.execute({
      sql: "SELECT id FROM posts WHERE id = ? LIMIT 1",
      args: [postId],
    });
    if (post.rows.length === 0) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const token = randomBytes(24).toString("base64url");
    const id = randomBytes(8).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await db.execute({
      sql: `INSERT INTO post_share_links (id, token, post_id, expires_at) VALUES (?, ?, ?, ?)`,
      args: [id, token, postId, expiresAt],
    });

    // Build the share URL from the request host so it always matches the domain
    // the admin is actually using, regardless of NEXT_PUBLIC_SITE_URL.
    const siteUrl = baseUrlFromRequest(request);
    return NextResponse.json({ shareUrl: `${siteUrl}/share/${token}` });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
