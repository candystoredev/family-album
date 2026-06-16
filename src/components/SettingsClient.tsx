"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

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
    <main className="min-h-screen max-w-[600px] mx-auto px-4 sm:px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-[#d3d3d3] text-2xl font-semibold">Settings</h1>
        <Link href="/" className="text-sm text-[#666] hover:text-[#d3d3d3] transition-colors">
          Done
        </Link>
      </div>

      {message && (
        <div className="mb-6 rounded-lg border border-[#427ea3]/40 bg-[#427ea3]/10 px-4 py-3 text-sm text-[#9cc4d9]">
          {message}
        </div>
      )}

      {/* ── Your device ── */}
      <section className="mb-10">
        <h2 className="text-[#666] text-xs uppercase tracking-widest mb-4">Your device</h2>
        <div className="rounded-lg border border-[#333] bg-[#252424] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[#d3d3d3] text-base font-medium">Daily memory notifications</p>
              <p className="text-[#888] text-sm mt-1 leading-relaxed">
                Get a teaser each morning with a memory from years past on this day.
              </p>
            </div>
          </div>

          {pushState === "loading" && (
            <p className="text-[#666] text-sm mt-4">Checking…</p>
          )}

          {pushState === "needs-install" && (
            <div className="mt-4 rounded-lg border border-[#333] bg-[#1d1c1c] p-4 text-sm text-[#a0a0a0] leading-relaxed">
              <p className="text-[#d3d3d3] font-medium mb-2">Add to Home Screen first</p>
              <p>
                On iPhone and iPad, notifications only work once this album is installed as an app:
              </p>
              <ol className="list-decimal ml-5 mt-2 space-y-1">
                <li>Tap the <span className="text-[#d3d3d3]">Share</span> button in Safari</li>
                <li>Choose <span className="text-[#d3d3d3]">Add to Home Screen</span></li>
                <li>Open the album from your Home Screen, then return here</li>
              </ol>
            </div>
          )}

          {pushState === "unsupported" && (
            <p className="text-[#888] text-sm mt-4">
              This browser doesn&apos;t support notifications. Try Chrome, Edge, or an installed
              {isIOS ? " Home Screen app" : " browser"}.
            </p>
          )}

          {pushState === "off" && (
            <button
              onClick={enable}
              disabled={busy}
              className="mt-4 w-full rounded-lg bg-[#427ea3] hover:bg-[#5a9ec5] disabled:opacity-50 text-white text-sm font-medium py-3 transition-colors"
            >
              {busy ? "Enabling…" : "Turn on daily memories"}
            </button>
          )}

          {pushState === "on" && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm text-[#6fae6f]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Notifications are on for this device
              </div>
              <div className="flex gap-2">
                <button
                  onClick={sendTest}
                  disabled={busy}
                  className="flex-1 rounded-lg border border-[#333] hover:border-[#555] disabled:opacity-50 text-[#d3d3d3] text-sm py-2.5 transition-colors"
                >
                  Send me a test
                </button>
                <button
                  onClick={disable}
                  disabled={busy}
                  className="flex-1 rounded-lg border border-[#333] hover:border-[#555] disabled:opacity-50 text-[#888] text-sm py-2.5 transition-colors"
                >
                  Turn off
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {isAdmin && adminSettings && (
        <AdminSettings settings={adminSettings} deviceCount={deviceCount} setMessage={setMessage} />
      )}
    </main>
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

  const labelCls = "block text-[#888] text-sm mb-1.5";
  const inputCls =
    "w-full bg-[#1d1c1c] text-[#d3d3d3] text-sm rounded-lg px-3 py-2.5 border border-[#333] focus:border-[#427ea3] focus:outline-none transition-colors";

  return (
    <section>
      <h2 className="text-[#666] text-xs uppercase tracking-widest mb-4">Admin</h2>
      <div className="rounded-lg border border-[#333] bg-[#252424] p-5 space-y-5">
        {/* Daily memories controls */}
        <div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.daily_notifications_enabled === "1"}
              onChange={(e) => update("daily_notifications_enabled", e.target.checked ? "1" : "0")}
              className="w-4 h-4 accent-[#427ea3]"
            />
            <span className="text-[#d3d3d3] text-sm">Send daily memory notifications</span>
          </label>
          <p className="text-[#666] text-xs mt-1.5 ml-7">
            {deviceCount} device{deviceCount === 1 ? "" : "s"} subscribed
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Send hour</label>
            <select
              value={form.notify_send_hour}
              onChange={(e) => update("notify_send_hour", e.target.value)}
              className={inputCls}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={String(h)}>
                  {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Timezone</label>
            <select
              value={form.notify_timezone}
              onChange={(e) => update("notify_timezone", e.target.value)}
              className={inputCls}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={sendNow}
          disabled={sending}
          className="w-full rounded-lg border border-[#427ea3]/50 text-[#9cc4d9] hover:bg-[#427ea3]/10 disabled:opacity-50 text-sm py-2.5 transition-colors"
        >
          {sending ? "Sending…" : "Send today's memory now"}
        </button>

        <div className="border-t border-[#333] pt-5 space-y-4">
          <div>
            <label className={labelCls}>Site title</label>
            <input
              type="text"
              value={form.site_title}
              onChange={(e) => update("site_title", e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Site description</label>
            <input
              type="text"
              value={form.site_description}
              onChange={(e) => update("site_description", e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Banner message</label>
            <input
              type="text"
              value={form.banner_message}
              onChange={(e) => update("banner_message", e.target.value)}
              placeholder="Optional message shown on the homepage"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>iMessage recipients</label>
            <input
              type="text"
              value={form.imessage_recipients}
              onChange={(e) => update("imessage_recipients", e.target.value)}
              placeholder="Comma-separated phone numbers"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Change family password</label>
            <input
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
          className="w-full rounded-lg bg-[#427ea3] hover:bg-[#5a9ec5] disabled:opacity-50 text-white text-sm font-medium py-3 transition-colors"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </section>
  );
}
