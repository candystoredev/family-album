"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTimelineStyle } from "@/lib/useTimelineStyle";

interface Props {
  isAdmin: boolean;
  adminSettings: Record<string, string> | null;
  deviceCount: number;
  vapidPublicKey: string;
}

/** VAPID public key (base64url) → ArrayBuffer for PushManager.subscribe. */
function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android device";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

type PushState = "loading" | "unsupported" | "needs-install" | "off" | "on";

// ─── Shared bits ──────────────────────────────────────────────────────────────

const sectionLabel = "text-[11px] font-bold tracking-[0.2em] uppercase text-[#8a774d] mb-3";

function ClockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="13" r="7" stroke="#cda86a" strokeWidth="1.8" />
      <path d="M12 10v3l2 1.5" stroke="#cda86a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 4l2.5 2M19 4l-2.5 2" stroke="#cda86a" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GoldBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="flex-none w-[46px] h-[46px] rounded-[13px] flex items-center justify-center"
      style={{
        background: "rgba(194,164,103,0.13)",
        border: "1px solid rgba(194,164,103,0.32)",
      }}
    >
      {children}
    </span>
  );
}

export default function SettingsClient({ isAdmin, adminSettings, deviceCount, vapidPublicKey }: Props) {
  const [pushState, setPushState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isIOS, setIsIOS] = useState(false);

  const refreshState = useCallback(async () => {
    if (typeof window === "undefined") return;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(ios);

    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

    // iOS only exposes PushManager once installed to the Home Screen.
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    if (!supported) {
      setPushState(ios && !standalone ? "needs-install" : "unsupported");
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setPushState(sub ? "on" : "off");
    } catch {
      setPushState("off");
    }
  }, []);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  const enable = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (!vapidPublicKey) {
        setMessage("Notifications aren't configured on the server yet.");
        setBusy(false);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Notifications were blocked. Enable them in your browser settings to continue.");
        setBusy(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(vapidPublicKey),
      });
      const res = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), label: deviceLabel() }),
      });
      if (!res.ok) throw new Error("subscribe failed");
      setPushState("on");
      setMessage("You're all set — you'll get a daily memory each morning.");
    } catch (err) {
      console.error(err);
      setMessage("Something went wrong enabling notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [vapidPublicKey]);

  const disable = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/notifications/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setPushState("off");
      setMessage("Daily memories turned off for this device.");
    } catch (err) {
      console.error(err);
      setMessage("Couldn't turn off notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  const sendTest = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setMessage("Turn on notifications first.");
        setBusy(false);
        return;
      }
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      if (!res.ok) throw new Error("test failed");
      setMessage("Test notification sent — check your notifications.");
    } catch (err) {
      console.error(err);
      setMessage("Couldn't send the test notification.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <main className="relative paper-grain min-h-screen max-w-[600px] mx-auto px-5 sm:px-6 pt-14 pb-12">
      <div className="relative">
        <div className="flex items-end justify-between mb-1.5">
          <h1 className="font-serif text-[32px] font-semibold tracking-[-0.01em] text-[#efeae1]">
            Settings
          </h1>
          <Link
            href="/"
            className="text-base font-semibold text-[#c2a467] hover:text-[#d2b577] transition-colors py-1.5 px-0.5"
          >
            Done
          </Link>
        </div>

        {message && (
          <div
            className="flex items-center gap-[9px] px-[14px] py-[11px] rounded-xl my-4 mb-[30px]"
            style={{
              background: "rgba(127,175,116,0.10)",
              border: "1px solid rgba(127,175,116,0.26)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="flex-none">
              <path d="M20 6L9 17l-5-5" stroke="#7faf74" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-sm text-[#a3c79a]">{message}</span>
          </div>
        )}

        {/* ── Your device ── */}
        <section className="mb-9">
          <h2 className={sectionLabel}>Your device</h2>
          <div
            className="rounded-[18px] bg-[#211e1a] p-5"
            style={{
              border: "1px solid rgba(194,164,103,0.24)",
              boxShadow: "0 8px 26px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div className="flex items-center gap-[13px] mb-[13px]">
              <GoldBadge>
                <ClockIcon />
              </GoldBadge>
              <div className="font-serif text-[19px] font-semibold text-[#f0ebe2]">
                Daily memory notifications
              </div>
            </div>
            <p className="text-[15px] leading-[1.55] text-[#a39e93] mb-[18px]">
              A gentle teaser each morning — a memory from years past, on this very day.
            </p>

            {pushState === "loading" && (
              <div className="flex items-center gap-[11px]">
                <span className="w-[18px] h-[18px] rounded-full border-2 border-[#322e29] border-t-[#c2a467] animate-hk-spin" />
                <span className="text-[15px] text-[#a39e93]">Checking your notification status…</span>
              </div>
            )}

            {pushState === "needs-install" && (
              <div>
                <div className="font-serif text-[17px] font-semibold text-[#f0ebe2] mb-[5px]">
                  Add to your Home Screen first
                </div>
                <p className="text-sm leading-[1.5] text-[#a39e93] mb-4">
                  Daily memories need the app installed. It takes a moment:
                </p>
                <div className="flex flex-col gap-[13px]">
                  <div className="flex items-center gap-3">
                    <StepNum n={1} />
                    <span className="flex-1 text-[14.5px] text-[#c9c4ba]">
                      Tap the <b className="text-[#cfae6f]">Share</b> button
                    </span>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="flex-none">
                      <path d="M12 3v12M12 3L8 7m4-4l4 4" stroke="#cfae6f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M5 12v7a1 1 0 001 1h12a1 1 0 001-1v-7" stroke="#cfae6f" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-3">
                    <StepNum n={2} />
                    <span className="flex-1 text-[14.5px] text-[#c9c4ba]">
                      Choose <b className="text-[#cfae6f]">Add to Home Screen</b>
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <StepNum n={3} />
                    <span className="flex-1 text-[14.5px] text-[#c9c4ba]">
                      Open it from your Home Screen, then return here
                    </span>
                  </div>
                </div>
              </div>
            )}

            {pushState === "unsupported" && (
              <div className="flex items-start gap-[11px]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="flex-none mt-px">
                  <circle cx="12" cy="12" r="9" stroke="#8a8378" strokeWidth="1.8" />
                  <path d="M12 8v5" stroke="#8a8378" strokeWidth="1.8" strokeLinecap="round" />
                  <circle cx="12" cy="16.5" r="1" fill="#8a8378" />
                </svg>
                <p className="text-[14.5px] leading-[1.5] text-[#a39e93]">
                  This browser can&apos;t do daily memory notifications. Open{" "}
                  <b className="text-[#c9c4ba]">The Hoecks</b> from your Home Screen
                  {isIOS ? " on iPhone or iPad" : ""} to turn them on.
                </p>
              </div>
            )}

            {pushState === "off" && (
              <button
                onClick={enable}
                disabled={busy}
                className="w-full min-h-[50px] rounded-[13px] bg-[#c2a467] hover:bg-[#d2b577] disabled:opacity-50 text-[#1a1715] text-[15px] font-bold transition-colors"
                style={{
                  border: "1px solid rgba(255,255,255,0.14)",
                  boxShadow: "0 10px 24px rgba(122,96,42,0.32)",
                }}
              >
                {busy ? "Enabling…" : "Turn on daily memories"}
              </button>
            )}

            {pushState === "on" && (
              <div className="space-y-[14px]">
                <div
                  className="flex items-center gap-[9px] px-[13px] py-[11px] rounded-xl"
                  style={{
                    background: "rgba(127,175,116,0.10)",
                    border: "1px solid rgba(127,175,116,0.24)",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="flex-none">
                    <path d="M20 6L9 17l-5-5" stroke="#7faf74" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-[15px] font-semibold text-[#8fbf83]">
                    Notifications are on for this device
                  </span>
                </div>
                <div className="flex gap-[10px]">
                  <button
                    onClick={sendTest}
                    disabled={busy}
                    className="flex-1 min-h-[48px] rounded-[13px] border border-[#3a352d] bg-[#211e1b] text-[#ddd7cc] text-[15px] font-semibold transition-colors hover:bg-[#272320] hover:border-[rgba(194,164,103,0.4)] disabled:opacity-50"
                  >
                    Send me a test
                  </button>
                  <button
                    onClick={disable}
                    disabled={busy}
                    className="flex-1 min-h-[48px] rounded-[13px] border border-[#3a352d] bg-[#211e1b] text-[#a39e93] text-[15px] font-semibold transition-colors hover:text-[#d98a87] hover:border-[rgba(217,101,95,0.35)] disabled:opacity-50"
                  >
                    Turn off
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Timeline layout (preference) ── */}
        <section className="mb-9">
          <TimelineLayoutCard />
        </section>

        {isAdmin && adminSettings && (
          <AdminSettings settings={adminSettings} deviceCount={deviceCount} setMessage={setMessage} />
        )}
      </div>
    </main>
  );
}

function StepNum({ n }: { n: number }) {
  return (
    <span
      className="flex-none w-[26px] h-[26px] rounded-full flex items-center justify-center font-serif text-sm font-semibold text-[#cfae6f]"
      style={{
        background: "rgba(194,164,103,0.14)",
        border: "1px solid rgba(194,164,103,0.34)",
      }}
    >
      {n}
    </span>
  );
}

function TimelineLayoutCard() {
  const [style, setStyle] = useTimelineStyle();
  const opt = (active: boolean) =>
    `flex-1 min-h-[44px] rounded-[9px] text-[15px] font-semibold transition-colors ${
      active ? "text-[#cfae6f]" : "text-[#8a8378]"
    }`;
  return (
    <div className="rounded-[18px] bg-[#1c1a18] border border-[#2b2722] px-5 py-[18px]">
      <div className="flex items-center gap-[13px] mb-1">
        <GoldBadge>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M9 6h12M9 12h12M9 18h12" stroke="#cda86a" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="4" cy="6" r="1.5" fill="#cda86a" />
            <circle cx="4" cy="12" r="1.5" fill="#cda86a" />
            <circle cx="4" cy="18" r="1.5" fill="#cda86a" />
          </svg>
        </GoldBadge>
        <div className="font-serif text-[19px] font-semibold text-[#f0ebe2]">Timeline layout</div>
      </div>
      <p className="text-[15px] leading-[1.55] text-[#a39e93] mb-4">
        How the years index appears in the menu. The year rail keeps any year a single tap away as
        the archive grows.
      </p>
      <div className="flex gap-1.5 bg-[#151312] border border-[#2b2722] rounded-[13px] p-[5px]">
        <button
          onClick={() => setStyle("classic")}
          className={opt(style === "classic")}
          style={style === "classic" ? { background: "rgba(194,164,103,0.15)" } : undefined}
        >
          Classic list
        </button>
        <button
          onClick={() => setStyle("rail")}
          className={opt(style === "rail")}
          style={style === "rail" ? { background: "rgba(194,164,103,0.15)" } : undefined}
        >
          Year rail
        </button>
      </div>
    </div>
  );
}

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "UTC",
];

function AdminSettings({
  settings,
  deviceCount,
  setMessage,
}: {
  settings: Record<string, string>;
  deviceCount: number;
  setMessage: (m: string | null) => void;
}) {
  const [form, setForm] = useState({
    site_title: settings.site_title ?? "",
    site_description: settings.site_description ?? "",
    banner_message: settings.banner_message ?? "",
    imessage_recipients: settings.imessage_recipients ?? "",
    daily_notifications_enabled: settings.daily_notifications_enabled ?? "1",
    notify_send_hour: settings.notify_send_hour ?? "8",
    notify_timezone: settings.notify_timezone ?? "America/New_York",
    viewer_password: "",
  });
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("save failed");
      setMessage("Settings saved.");
      setForm((f) => ({ ...f, viewer_password: "" }));
    } catch {
      setMessage("Couldn't save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function sendNow() {
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/notifications/daily?force=1", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "send failed");
      if (data.skipped) {
        setMessage(`Nothing sent: ${data.skipped}`);
      } else {
        setMessage(`Sent to ${data.sent} device(s)${data.removed ? `, removed ${data.removed} stale` : ""}.`);
      }
    } catch (err) {
      setMessage(`Couldn't send: ${String(err)}`);
    } finally {
      setSending(false);
    }
  }

  const labelCls =
    "block text-xs font-bold tracking-[0.1em] uppercase text-[#8a8378] mb-2";
  const inputCls =
    "gold-focus w-full h-12 bg-[#151312] text-[#ece8e1] text-base rounded-xl px-[14px] border border-[#322e29] transition-shadow placeholder:text-[#6c675d]";
  const selectCls =
    "gold-focus appearance-none w-full h-12 bg-[#151312] text-[#ece8e1] text-[15px] rounded-xl pl-[14px] pr-[38px] border border-[#322e29] transition-shadow";

  const notifOn = form.daily_notifications_enabled === "1";

  return (
    <>
    <section>
      <h2 className={sectionLabel}>Admin</h2>
      <Link
        href="/admin/people/faces"
        className="flex items-center justify-between rounded-[18px] bg-[#1c1a18] border border-[#2b2722] p-5 mb-4 hover:border-[#c2a467]/50 transition-colors"
      >
        <div>
          <div className="text-base font-semibold text-[#e5e0d6]">Faces → People</div>
          <div className="text-[13px] text-[#7d7468] mt-0.5">
            Find faces in your photos and name them — all on-device
          </div>
        </div>
        <span className="text-[#8a774d] text-xl">→</span>
      </Link>
      <div className="rounded-[18px] bg-[#1c1a18] border border-[#2b2722] p-5">
        {/* Daily memories master toggle */}
        <div className="flex items-center gap-[14px] pb-[18px] border-b border-[#2b2722]">
          <div className="flex-1">
            <div className="text-base font-semibold text-[#e5e0d6]">
              Send daily memory notifications
            </div>
            <div className="text-[13px] text-[#7d7468] mt-0.5">
              {deviceCount} device{deviceCount === 1 ? "" : "s"} subscribed
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={notifOn}
            aria-label="Send daily memory notifications"
            onClick={() => update("daily_notifications_enabled", notifOn ? "0" : "1")}
            className="flex-none w-[52px] h-8 rounded-full relative transition-colors duration-200"
            style={{
              background: notifOn ? "#c2a467" : "#3a352d",
              boxShadow: "inset 0 1px 3px rgba(0,0,0,0.35)",
            }}
          >
            <span
              className="absolute top-[3px] w-[26px] h-[26px] rounded-full bg-[#f3eee4] transition-[left] duration-200 ease-out"
              style={{ left: notifOn ? "23px" : "3px", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }}
            />
          </button>
        </div>

        {/* Send hour + timezone */}
        <div className="grid grid-cols-2 gap-3 py-[18px]">
          <div>
            <label className={labelCls} htmlFor="notify_send_hour">Send hour</label>
            <div className="relative">
              <select
                id="notify_send_hour"
                value={form.notify_send_hour}
                onChange={(e) => update("notify_send_hour", e.target.value)}
                className={selectCls}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={String(h)}>
                    {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="notify_timezone">Timezone</label>
            <div className="relative">
              <select
                id="notify_timezone"
                value={form.notify_timezone}
                onChange={(e) => update("notify_timezone", e.target.value)}
                className={selectCls}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </div>
        </div>

        <button
          onClick={sendNow}
          disabled={sending}
          className="w-full min-h-[50px] rounded-[13px] text-[15px] font-semibold text-[#cfae6f] transition-colors disabled:opacity-50 mb-[18px]"
          style={{
            background: "rgba(194,164,103,0.08)",
            border: "1px solid rgba(194,164,103,0.4)",
          }}
        >
          {sending ? "Sending…" : "Send today's memory now"}
        </button>

        <div className="h-px bg-[#2b2722] mb-[18px]" />

        <div className="flex flex-col gap-4">
          <div>
            <label className={labelCls} htmlFor="site_title">Site title</label>
            <input
              id="site_title"
              type="text"
              value={form.site_title}
              onChange={(e) => update("site_title", e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="site_description">Site description</label>
            <input
              id="site_description"
              type="text"
              value={form.site_description}
              onChange={(e) => update("site_description", e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="banner_message">Banner message</label>
            <input
              id="banner_message"
              type="text"
              value={form.banner_message}
              onChange={(e) => update("banner_message", e.target.value)}
              placeholder="Optional message shown on the homepage"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="imessage_recipients">iMessage recipients</label>
            <input
              id="imessage_recipients"
              type="text"
              value={form.imessage_recipients}
              onChange={(e) => update("imessage_recipients", e.target.value)}
              placeholder="Comma-separated phone numbers"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="viewer_password">Change family password</label>
            <input
              id="viewer_password"
              type="password"
              value={form.viewer_password}
              onChange={(e) => update("viewer_password", e.target.value)}
              placeholder="Leave blank to keep current"
              autoComplete="new-password"
              className={inputCls}
            />
          </div>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="w-full min-h-[52px] rounded-[14px] bg-[#c2a467] hover:bg-[#d2b577] disabled:opacity-50 text-[#1a1715] text-base font-bold transition-colors mt-[22px]"
          style={{
            border: "1px solid rgba(255,255,255,0.14)",
            boxShadow: "0 10px 24px rgba(122,96,42,0.35), inset 0 1px 0 rgba(255,255,255,0.35)",
          }}
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </section>

    <ShareLinksSection setMessage={setMessage} />
    </>
  );
}

// ─── Share links (Phase 11e) ────────────────────────────────────────────────

interface PostShareLink {
  token: string;
  post_id: string;
  slug: string | null;
  title: string | null;
  created_at: string;
  expires_at: string | null;
  revoked: number;
}

interface DayShareLink {
  token: string;
  year: number;
  month: number;
  day: number;
  created_at: string;
  revoked: number;
}

function formatShareDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function ShareLinkRow({
  label,
  path,
  createdAt,
  revoked,
  busy,
  onRevoke,
}: {
  label: string;
  path: string;
  createdAt: string;
  revoked: boolean;
  busy: boolean;
  onRevoke: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 py-3 border-b border-[#2b2722] last:border-b-0"
      style={revoked ? { opacity: 0.45 } : undefined}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold text-[#e5e0d6] truncate">{label}</div>
        <div className="text-[12px] text-[#7d7468] mt-0.5 truncate">
          {path} · {formatShareDate(createdAt)}
        </div>
      </div>
      {revoked ? (
        <span className="flex-none text-[11px] font-bold tracking-[0.1em] uppercase text-[#8a7d6a]">
          Revoked
        </span>
      ) : (
        <button
          type="button"
          onClick={onRevoke}
          disabled={busy}
          className="flex-none min-h-[36px] px-4 rounded-[10px] text-[13px] font-semibold text-[#d98a87] border border-[rgba(217,101,95,0.35)] transition-colors hover:bg-[rgba(217,101,95,0.08)] disabled:opacity-50"
        >
          Revoke
        </button>
      )}
    </div>
  );
}

function ShareLinksSection({ setMessage }: { setMessage: (m: string | null) => void }) {
  const [postLinks, setPostLinks] = useState<PostShareLink[]>([]);
  const [dayLinks, setDayLinks] = useState<DayShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/share-links");
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setPostLinks(data.postLinks ?? []);
      setDayLinks(data.dayLinks ?? []);
    } catch {
      setMessage("Couldn't load share links.");
    } finally {
      setLoading(false);
    }
  }, [setMessage]);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(type: "post" | "day", token: string) {
    setRevokingToken(token);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, token }),
      });
      if (!res.ok) throw new Error("revoke failed");
      // Optimistic update — avoids a full reload for a single flag flip.
      if (type === "post") {
        setPostLinks((links) => links.map((l) => (l.token === token ? { ...l, revoked: 1 } : l)));
      } else {
        setDayLinks((links) => links.map((l) => (l.token === token ? { ...l, revoked: 1 } : l)));
      }
      setMessage("Link revoked.");
    } catch {
      setMessage("Couldn't revoke link — try again.");
    } finally {
      setRevokingToken(null);
    }
  }

  function postLabel(l: PostShareLink): string {
    return l.title || l.slug || `/share/${l.token.slice(0, 8)}…`;
  }

  function dayShareLabel(l: DayShareLink): string {
    const mm = String(l.month).padStart(2, "0");
    const dd = String(l.day).padStart(2, "0");
    return `On this day — ${l.year}-${mm}-${dd}`;
  }

  const activePostLinks = postLinks.filter((l) => !l.revoked);
  const revokedPostLinks = postLinks.filter((l) => l.revoked);
  const activeDayLinks = dayLinks.filter((l) => !l.revoked);
  const revokedDayLinks = dayLinks.filter((l) => l.revoked);
  const hasAnyLinks = postLinks.length > 0 || dayLinks.length > 0;
  const hasActiveLinks = activePostLinks.length > 0 || activeDayLinks.length > 0;
  const hasRevokedLinks = revokedPostLinks.length > 0 || revokedDayLinks.length > 0;

  return (
    <section className="mt-9">
      <h2 className={sectionLabel}>Share links</h2>
      <div className="rounded-[18px] bg-[#1c1a18] border border-[#2b2722] p-5">
        {loading ? (
          <p className="text-[13px] text-[#7d7468]">Loading…</p>
        ) : !hasAnyLinks ? (
          <p className="text-[13px] text-[#7d7468]">No share links yet.</p>
        ) : (
          <>
            {hasActiveLinks ? (
              <div>
                {activePostLinks.map((l) => (
                  <ShareLinkRow
                    key={`post-${l.token}`}
                    label={postLabel(l)}
                    path={`/share/${l.token.slice(0, 8)}…`}
                    createdAt={l.created_at}
                    revoked={false}
                    busy={revokingToken === l.token}
                    onRevoke={() => revoke("post", l.token)}
                  />
                ))}
                {activeDayLinks.map((l) => (
                  <ShareLinkRow
                    key={`day-${l.token}`}
                    label={dayShareLabel(l)}
                    path={`/m/${l.token.slice(0, 8)}…`}
                    createdAt={l.created_at}
                    revoked={false}
                    busy={revokingToken === l.token}
                    onRevoke={() => revoke("day", l.token)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-[#7d7468]">No active links.</p>
            )}

            {hasRevokedLinks && (
              <>
                <div className="h-px bg-[#2b2722] my-3" />
                <p className="text-xs font-bold tracking-[0.1em] uppercase text-[#8a8378] mb-1">
                  Revoked
                </p>
                {revokedPostLinks.map((l) => (
                  <ShareLinkRow
                    key={`post-${l.token}`}
                    label={postLabel(l)}
                    path={`/share/${l.token.slice(0, 8)}…`}
                    createdAt={l.created_at}
                    revoked={true}
                    busy={false}
                    onRevoke={() => {}}
                  />
                ))}
                {revokedDayLinks.map((l) => (
                  <ShareLinkRow
                    key={`day-${l.token}`}
                    label={dayShareLabel(l)}
                    path={`/m/${l.token.slice(0, 8)}…`}
                    createdAt={l.created_at}
                    revoked={true}
                    busy={false}
                    onRevoke={() => {}}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function SelectChevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className="absolute right-[13px] top-1/2 -translate-y-1/2 pointer-events-none"
    >
      <path d="M6 9l6 6 6-6" stroke="#857f73" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
