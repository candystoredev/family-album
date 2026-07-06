import { NextResponse } from "next/server";
import { initializeSchema, rebuildFtsIndex } from "@/lib/schema";
import { db } from "@/lib/db";
import { bearerMatches } from "@/lib/safeCompare";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  // Only allow with admin API token (constant-time; fails closed if unset)
  const auth = request.headers.get("authorization");
  if (!(await bearerMatches(auth, process.env.ADMIN_API_TOKEN))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await initializeSchema();

    // Seed site_settings with defaults if they don't exist
    const defaults: Record<string, string> = {
      site_title: "The Hoecks",
      site_description: "Family Photo Album",
      imessage_recipients: "",
      // Daily "On this day" push notifications
      daily_notifications_enabled: "1",
      notify_send_hour: "8", // local hour (0-23) in notify_timezone
      notify_timezone: "America/New_York",
      notify_last_sent_date: "", // YYYY-MM-DD guard against duplicate sends
    };

    for (const [key, value] of Object.entries(defaults)) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)`,
        args: [key, value],
      });
    }

    // Set viewer password from env if not already set
    const existing = await db.execute({
      sql: "SELECT key FROM site_settings WHERE key = ?",
      args: ["viewer_password_hash"],
    });

    // Seed the viewer password only from the env var — never a hardcoded
    // default (a source-visible default would gate the whole album). If unset,
    // leave it unconfigured; the admin can set one from Settings.
    if (existing.rows.length === 0 && process.env.VIEWER_PASSWORD) {
      const hash = await bcrypt.hash(process.env.VIEWER_PASSWORD, 12);
      await db.execute({
        sql: `INSERT INTO site_settings (key, value) VALUES (?, ?)`,
        args: ["viewer_password_hash", hash],
      });
    }

    // Rebuild FTS5 search index
    await rebuildFtsIndex();

    return NextResponse.json({ ok: true, message: "Schema initialized, settings seeded, FTS rebuilt" });
  } catch (error) {
    console.error("Init error:", error);
    return NextResponse.json(
      { error: "Initialization failed", details: String(error) },
      { status: 500 }
    );
  }
}
