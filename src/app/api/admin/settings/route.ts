import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensurePushSchema } from "@/lib/schema";
import { getSettings, setSetting } from "@/lib/settings";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

// Plain key/value settings an admin may edit from the Settings page.
const EDITABLE_KEYS = [
  "site_title",
  "site_description",
  "banner_message",
  "imessage_recipients",
  "daily_notifications_enabled",
  "notify_send_hour",
  "notify_timezone",
] as const;

export async function GET() {
  const settings = await getSettings([...EDITABLE_KEYS]);
  // Count subscribed devices so admins can see reach at a glance.
  await ensurePushSchema();
  const countResult = await db.execute("SELECT COUNT(*) as n FROM push_subscriptions");
  const deviceCount = Number((countResult.rows[0] as unknown as { n: number }).n ?? 0);
  return NextResponse.json({ settings, deviceCount });
}

export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Update any provided editable keys.
  for (const key of EDITABLE_KEYS) {
    if (key in body && typeof body[key] === "string") {
      let value = body[key] as string;
      if (key === "notify_send_hour") {
        const hour = Math.max(0, Math.min(23, parseInt(value, 10) || 0));
        value = String(hour);
      }
      if (key === "daily_notifications_enabled") {
        value = value === "1" || value === "true" ? "1" : "0";
      }
      await setSetting(key, value);
    }
  }

  // Optional viewer password change — stored as a bcrypt hash.
  if (typeof body.viewer_password === "string" && body.viewer_password.length > 0) {
    const hash = await bcrypt.hash(body.viewer_password, 12);
    await setSetting("viewer_password_hash", hash);
  }

  const settings = await getSettings([...EDITABLE_KEYS]);
  return NextResponse.json({ ok: true, settings });
}
