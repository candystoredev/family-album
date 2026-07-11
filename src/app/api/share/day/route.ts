import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ensureDayShareSchema } from "@/lib/schema";

/**
 * Mint (or reuse) an unguessable share link for an "On this day" date.
 * Any logged-in family member may create one — it only exposes content they can
 * already see. Reuses an existing token for the same day so links stay stable.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { year, month, day } = await request.json();
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (
      !Number.isInteger(y) || y < 1900 || y > 3000 ||
      !Number.isInteger(m) || m < 1 || m > 12 ||
      !Number.isInteger(d) || d < 1 || d > 31
    ) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    await ensureDayShareSchema();

    const existing = await db.execute({
      sql: `SELECT token FROM day_share_links WHERE year = ? AND month = ? AND day = ? LIMIT 1`,
      args: [y, m, d],
    });
    let token = (existing.rows[0] as unknown as { token?: string })?.token;

    if (!token) {
      token = randomBytes(18).toString("base64url");
      await db.execute({
        sql: `INSERT INTO day_share_links (token, year, month, day) VALUES (?, ?, ?, ?)`,
        args: [token, y, m, d],
      });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thehoecks.com";
    return NextResponse.json({ shareUrl: `${siteUrl}/m/${token}` });
  } catch (error) {
    console.error("Create day share link error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
