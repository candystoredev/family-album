import { db } from "./db";

/**
 * Simple Turso-backed fixed-window rate limiter — no external infra needed.
 * Used to throttle login attempts per client IP so the shared family/admin
 * password can't be brute-forced (and to blunt bcrypt compute-DoS).
 */

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 10; // per window, per IP

let ready = false;
async function ensureTable() {
  if (ready) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS login_attempts (
    ip TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    window_start INTEGER NOT NULL
  )`);
  ready = true;
}

export interface RateLimitResult {
  limited: boolean;
  retryAfter: number; // seconds until the window resets (when limited)
}

/**
 * Record an attempt for `ip` and report whether it's now over the limit.
 * Atomic upsert: resets the window when it has elapsed, else increments.
 */
export async function hitLoginRateLimit(ip: string): Promise<RateLimitResult> {
  await ensureTable();
  const now = Date.now();

  await db.execute({
    sql: `INSERT INTO login_attempts (ip, count, window_start)
          VALUES (?, 1, ?)
          ON CONFLICT(ip) DO UPDATE SET
            count = CASE WHEN ? - window_start > ? THEN 1 ELSE count + 1 END,
            window_start = CASE WHEN ? - window_start > ? THEN ? ELSE window_start END`,
    args: [ip, now, now, WINDOW_MS, now, WINDOW_MS, now],
  });

  const res = await db.execute({
    sql: "SELECT count, window_start FROM login_attempts WHERE ip = ?",
    args: [ip],
  });
  const row = res.rows[0] as unknown as { count: number; window_start: number } | undefined;
  if (!row) return { limited: false, retryAfter: 0 };

  const limited = row.count > MAX_ATTEMPTS;
  const retryAfter = limited
    ? Math.max(1, Math.ceil((row.window_start + WINDOW_MS - now) / 1000))
    : 0;
  return { limited, retryAfter };
}

/** Clear a client's attempts after a successful login. */
export async function clearLoginRateLimit(ip: string): Promise<void> {
  await ensureTable();
  await db.execute({ sql: "DELETE FROM login_attempts WHERE ip = ?", args: [ip] });
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
