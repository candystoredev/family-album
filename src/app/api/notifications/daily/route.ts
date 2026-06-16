import { NextRequest, NextResponse } from "next/server";
import { getMemoriesForDate } from "@/lib/onThisDay";
import { buildDailyPayload, sendPushToAll } from "@/lib/push";
import { getSettings, setSetting } from "@/lib/settings";
import { zonedNow } from "@/lib/datetime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  return (
    (!!process.env.CRON_SECRET && token === process.env.CRON_SECRET) ||
    (!!process.env.ADMIN_API_TOKEN && token === process.env.ADMIN_API_TOKEN)
  );
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // `force=1` bypasses the hour + already-sent guards (manual admin trigger).
  const force = req.nextUrl.searchParams.get("force") === "1";

  const settings = await getSettings([
    "daily_notifications_enabled",
    "notify_send_hour",
    "notify_timezone",
    "notify_last_sent_date",
  ]);

  if (settings.daily_notifications_enabled === "0" && !force) {
    return NextResponse.json({ skipped: "notifications disabled" });
  }

  const timezone = settings.notify_timezone || "America/New_York";
  const sendHour = Number(settings.notify_send_hour ?? "8");
  const now = zonedNow(timezone);

  if (!force) {
    if (now.hour !== sendHour) {
      return NextResponse.json({ skipped: `not send hour (now ${now.hour}, want ${sendHour})` });
    }
    if (settings.notify_last_sent_date === now.date) {
      return NextResponse.json({ skipped: "already sent today" });
    }
  }

  const memories = await getMemoriesForDate(now.month, now.day);
  const payload = buildDailyPayload(memories);

  if (!payload) {
    // No memories today — skip silently, don't mark as sent.
    return NextResponse.json({ skipped: "no memories today", date: now.date });
  }

  const result = await sendPushToAll(payload);

  // Mark sent so the same day can't double-send (skip when forcing).
  if (!force) {
    await setSetting("notify_last_sent_date", now.date);
  }

  return NextResponse.json({ ok: true, date: now.date, payload, ...result });
}
