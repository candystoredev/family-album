"use client";

import { useState } from "react";

export default function BannerMessage({ message }: { message: string }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="bg-[#252424] border-b border-[#333] px-4 py-3">
      <div className="max-w-[900px] mx-auto flex items-center justify-between gap-3">
        <p className="text-[#d3d3d3] text-sm">{message}</p>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-[#555] hover:text-[#888] transition-colors"
          aria-label="Dismiss banner"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
