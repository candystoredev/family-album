import webpush from "web-push";
import { db } from "./db";
import { ensurePushSchema } from "./schema";
import type { OnThisDayPost } from "./onThisDay";

let configured = false;

/** Lazily configure web-push with VAPID details. Returns false if keys are missing. */
function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@thehoecks.com";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Big hero image (rendered inline on Android/desktop; ignored by iOS). */
  image?: string;
  /** Deep link opened on notification tap. */
  url: string;
  icon?: string;
  tag?: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Send a payload to every stored device subscription. Dead subscriptions
 * (HTTP 404/410) are pruned automatically. Returns a small summary.
 */
export async function sendPushToAll(
  payload: PushPayload
): Promise<{ sent: number; failed: number; removed: number; total: number }> {
  if (!ensureConfigured()) {
    throw new Error("VAPID keys not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)");
  }
  await ensurePushSchema();

  const result = await db.execute(
    "SELECT id, endpoint, p256dh, auth FROM push_subscriptions"
  );
  const subs = result.rows as unknown as SubscriptionRow[];

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  let removed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
        sent++;
        await db.execute({
          sql: "UPDATE push_subscriptions SET last_success_at = datetime('now') WHERE id = ?",
          args: [sub.id],
        });
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription expired or was revoked on the device — remove it.
          removed++;
          await db.execute({
            sql: "DELETE FROM push_subscriptions WHERE id = ?",
            args: [sub.id],
          });
        } else {
          failed++;
          console.error("Push send failed:", statusCode, err);
        }
      }
    })
  );

  return { sent, failed, removed, total: subs.length };
}

/** Send a payload to a single subscription endpoint (used by the test button). */
export async function sendPushToEndpoint(
  endpoint: string,
  payload: PushPayload
): Promise<void> {
  if (!ensureConfigured()) {
    throw new Error("VAPID keys not configured");
  }
  await ensurePushSchema();
  const result = await db.execute({
    sql: "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ?",
    args: [endpoint],
  });
  if (result.rows.length === 0) throw new Error("Subscription not found");
  const sub = result.rows[0] as unknown as SubscriptionRow;
  await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload)
  );
}

/**
 * Turn the day's memories into a teaser notification. The hero memory drives
 * the title/image; the body teases what's waiting. Returns null when there's
 * nothing worth sending (caller should skip).
 */
export function buildDailyPayload(memories: OnThisDayPost[]): PushPayload | null {
  if (memories.length === 0) return null;

  const hero = memories[0];
  const currentYear = new Date().getFullYear();
  const heroYear = new Date(hero.date).getFullYear();
  const yearsAgo = currentYear - heroYear;
  const yearsLabel = yearsAgo === 1 ? "1 year ago today" : `${yearsAgo} years ago today`;

  // Strip any HTML from the caption for the notification body.
  const captionText = hero.body ? hero.body.replace(/<[^>]+>/g, "").trim() : "";
  const teaser = hero.title || captionText;

  const photoCount = memories.reduce((n, m) => n + m.media.length, 0);
  const extraMemories = memories.length - 1;

  let body: string;
  if (teaser) {
    body = teaser;
  } else if (photoCount > 0) {
    body = photoCount === 1 ? "A photo from the archive" : `${photoCount} photos from the archive`;
  } else {
    body = "Tap to take a walk down memory lane";
  }
  if (extraMemories > 0) {
    body += extraMemories === 1 ? " · +1 more memory" : ` · +${extraMemories} more memories`;
  }

  // Prefer a thumbnail (smaller, faster); fall back to the full image.
  const heroMedia = hero.media[0];
  const image = hero.thumbnailUrl || heroMedia?.url || undefined;

  return {
    title: yearsLabel,
    body,
    image,
    url: "/today",
    icon: "/icon-192.png",
    tag: "daily-memory",
  };
}
