import { NextResponse } from "next/server";
import { initializeSchema } from "@/lib/schema";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  // Only allow with admin API token
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.ADMIN_API_TOKEN}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await initializeSchema();

    // Seed site_settings with defaults if they don't exist
    const defaults: Record<string, string> = {
      site_title: "The Hoecks",
      site_description: "Family Photo Album",
      imessage_recipients: "",
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

    if (existing.rows.length === 0) {
      const defaultPassword = process.env.VIEWER_PASSWORD || "hoecks2025";
      const hash = await bcrypt.hash(defaultPassword, 12);
      await db.execute({
        sql: `INSERT INTO site_settings (key, value) VALUES (?, ?)`,
        args: ["viewer_password_hash", hash],
      });
    }

    return NextResponse.json({ ok: true, message: "Schema initialized and settings seeded" });
  } catch (error) {
    console.error("Init error:", error);
    return NextResponse.json(
      { error: "Initialization failed", details: String(error) },
      { status: 500 }
    );
  }
}
