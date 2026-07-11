import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDayShareSchema, ensurePostShareSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

interface PostLinkRow {
  token: string;
  post_id: string;
  slug: string | null;
  title: string | null;
  created_at: string;
  expires_at: string | null;
  revoked: number;
}

interface DayLinkRow {
  token: string;
  year: number;
  month: number;
  day: number;
  created_at: string;
  revoked: number;
}

// GET: list every share link (post + day), most recent first, revoked included
// so the admin UI can show state rather than just active links.
export async function GET() {
  await ensurePostShareSchema();
  await ensureDayShareSchema();

  const postLinksResult = await db.execute(
    `SELECT
       psl.token AS token,
       psl.post_id AS post_id,
       p.slug AS slug,
       p.title AS title,
       psl.created_at AS created_at,
       psl.expires_at AS expires_at,
       psl.revoked AS revoked
     FROM post_share_links psl
     LEFT JOIN posts p ON p.id = psl.post_id
     ORDER BY psl.created_at DESC`
  );

  const dayLinksResult = await db.execute(
    `SELECT token, year, month, day, created_at, revoked
     FROM day_share_links
     ORDER BY created_at DESC`
  );

  return NextResponse.json({
    postLinks: postLinksResult.rows as unknown as PostLinkRow[],
    dayLinks: dayLinksResult.rows as unknown as DayLinkRow[],
  });
}

// POST: revoke a link. Body: { type: "post" | "day", token: string }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { type, token } = body;
  if (type !== "post" && type !== "day") {
    return NextResponse.json({ error: "type must be 'post' or 'day'" }, { status: 400 });
  }
  if (typeof token !== "string" || token.length === 0) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  await ensurePostShareSchema();
  await ensureDayShareSchema();

  const table = type === "post" ? "post_share_links" : "day_share_links";
  await db.execute({
    sql: `UPDATE ${table} SET revoked = 1 WHERE token = ?`,
    args: [token],
  });

  return NextResponse.json({ ok: true });
}
