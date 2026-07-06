import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMemoriesForDate } from "@/lib/onThisDay";
import { buildDailyPayload, sendPushToAll } from "@/lib/push";
import { getSettings, setSetting } from "@/lib/settings";
import { zonedNow } from "@/lib/datetime";
import { bearerMatches } from "@/lib/safeCompare";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function isAuthorized(req: NextRequest): Promise<boolean> {
  // Cron / API callers authenticate with a bearer token (constant-time,
  // fails closed if the secret is unset).
  const auth = req.headers.get("authorization");
  if (
    (await bearerMatches(auth, process.env.CRON_SECRET)) ||
    (await bearerMatches(auth, process.env.ADMIN_API_TOKEN))
  ) {
    return true;
  }
  // The admin "Send now" button authenticates with the logged-in session.
  const session = await getSession();
  return session?.role === "admin";
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
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
    // Send once per day, on the first run at or after the configured local
    // hour. GitHub Actions schedules are best-effort and often skip the exact
    // hour, so "due and not yet sent" (rather than an exact-hour match) lets a
    // missed run self-heal on the next one instead of losing the whole day.
    if (settings.notify_last_sent_date === now.date) {
      return NextResponse.json({ skipped: "already sent today" });
    }
    if (now.hour < sendHour) {
      return NextResponse.json({ skipped: `before send hour (now ${now.hour}, want ${sendHour})` });
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
