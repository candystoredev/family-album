"use client";

import { useState } from "react";

/**
 * Shares an "On this day" link. Mints an unguessable token link
 * (/m/<token>) on the server so it previews nicely, opens without the family
 * login, and can't be guessed — then hands it to the native share sheet
 * (clipboard fallback). `date` is YYYY-MM-DD for the day being viewed.
 */
export default function ShareDayButton({ date, label }: { date: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      const [year, month, day] = date.split("-").map(Number);
      const res = await fetch("/api/share/day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, day }),
      });
      if (!res.ok) throw new Error("share failed");
      const { shareUrl } = await res.json();
      const title = `On this day — ${label}`;

      if (navigator.share) {
        try {
          await navigator.share({ title, url: shareUrl });
          return;
        } catch {
          /* cancelled or unsupported — fall through to copy */
        }
      }
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* network/clipboard failure — silently ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={share}
      disabled={busy}
      className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-[13px] text-[15px] font-semibold text-[#cfae6f] transition-colors disabled:opacity-60"
      style={{
        background: "rgba(194,164,103,0.08)",
        border: "1px solid rgba(194,164,103,0.4)",
      }}
    >
      {copied ? (
        <>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="#cfae6f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Link copied
        </>
      ) : (
        <>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="18" cy="5" r="3" stroke="#cfae6f" strokeWidth="1.8" />
            <circle cx="6" cy="12" r="3" stroke="#cfae6f" strokeWidth="1.8" />
            <circle cx="18" cy="19" r="3" stroke="#cfae6f" strokeWidth="1.8" />
            <path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4" stroke="#cfae6f" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {busy ? "Preparing…" : "Share this day"}
        </>
      )}
    </button>
  );
}
