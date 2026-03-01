"use client";

import { useEffect, useState } from "react";

interface IMessageButtonProps {
  recipients: string; // comma-separated phone numbers
  postUrl: string;
  postTitle: string | null;
}

export default function IMessageButton({
  recipients,
  postUrl,
  postTitle,
}: IMessageButtonProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Detect touch device (phone/tablet) for sms: link support
    setIsMobile(
      "ontouchstart" in window || navigator.maxTouchPoints > 0
    );
  }, []);

  if (!recipients) return null;

  const numbers = recipients
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  if (numbers.length === 0) return null;

  // Pre-filled message body
  const body = `${postUrl}\n\nMy reaction:\n`;

  if (isMobile) {
    // sms: URL scheme — works on iOS and Android
    const smsUrl = `sms:${numbers.join(",")}&body=${encodeURIComponent(body)}`;

    return (
      <a
        href={smsUrl}
        className="inline-flex items-center gap-3 bg-[#34C759] hover:bg-[#2DB84D] text-white font-semibold text-base px-6 py-3.5 rounded-xl transition-colors"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-5 h-5 shrink-0"
        >
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
          <path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z" />
        </svg>
        <span>Text us about this</span>
      </a>
    );
  }

  // Desktop fallback — show phone numbers
  const formatted = numbers
    .map((n) => {
      // Format US numbers nicely
      const digits = n.replace(/\D/g, "");
      if (digits.length === 11 && digits[0] === "1") {
        return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
      }
      return n;
    })
    .join(" or ");

  return (
    <p className="text-[#666] text-sm">
      To share your thoughts, text us at{" "}
      <span className="text-[#34C759]">{formatted}</span>
      {postTitle && (
        <>
          {" "}
          and mention &ldquo;{postTitle}&rdquo;
        </>
      )}
    </p>
  );
}
