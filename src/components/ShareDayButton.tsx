"use client";

import { useState } from "react";

/**
 * Shares a date-pinned "On this day" link (/today?date=YYYY-MM-DD) so the
 * recipient sees the same day's memories whenever they open it — not their own
 * "today". Uses the native share sheet when available, else copies to clipboard.
 */
export default function ShareDayButton({ date, label }: { date: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/today?date=${date}`;
    const title = `On this day — ${label}`;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* user cancelled or share failed — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — nothing more we can do silently */
    }
  }

  return (
    <button
      onClick={share}
      className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-[13px] text-[15px] font-semibold text-[#cfae6f] transition-colors"
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
          Share this day
        </>
      )}
    </button>
  );
}
