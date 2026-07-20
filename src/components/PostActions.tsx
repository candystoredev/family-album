"use client";

import { useRef, useState } from "react";
import Link from "next/link";

/**
 * The post action sheet and its long-press trigger, shared by every surface
 * that shows a post caption: the feed, the On This Day slide-out, and the
 * individual post page. Extracted from Feed's PostCard so the share machinery
 * (token prefetch, native share, copy fallback) exists exactly once.
 *
 * Wrap the caption content: holding it 500ms (or right-clicking) opens the
 * sheet. Admins get Edit + a minted share link; family members get the SMS
 * share to the configured recipients. `viewPostHref` adds a "View post" item —
 * used on On This Day, where the sheet replaces the old hold-to-navigate
 * shortcut so navigation stays available but visible.
 *
 * The public /share/[token] page must NOT render this — friends shouldn't see
 * Edit/Share (PostContent only wraps with it when given a postId).
 */

interface PostActionsProps {
  postId: string;
  slug: string;
  title: string | null;
  isAdmin?: boolean;
  /** Parsed recipient list for the non-admin SMS share. */
  recipients: string[];
  siteUrl: string;
  /** When set, the sheet gains a "View post" item linking here. */
  viewPostHref?: string;
  /** Class for the pressable wrapper around the caption content. */
  className?: string;
  children: React.ReactNode;
}

export default function PostActions({
  postId,
  slug,
  title,
  isAdmin,
  recipients,
  siteUrl,
  viewPostHref,
  className,
  children,
}: PostActionsProps) {
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareLinkLoading, setShareLinkLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActivated = useRef(false);
  const pointerStart = useRef({ x: 0, y: 0 });
  // Pre-fetched share URL — populated while the sheet is open so the Share tap
  // can call navigator.share synchronously (iOS user-gesture requirement).
  const prefetchedShareUrl = useRef<string | null>(null);
  const sharePromise = useRef<Promise<string | null> | null>(null);

  function openSheet() {
    setShowActionSheet(true);
    if (navigator.vibrate) navigator.vibrate(20);
    if (isAdmin) {
      prefetchedShareUrl.current = null;
      sharePromise.current = fetchShareUrl();
    }
  }

  function startLongPress(e: React.PointerEvent) {
    pointerStart.current = { x: e.clientX, y: e.clientY };
    longPressActivated.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressActivated.current = true;
      openSheet();
    }, 500);
  }

  function cancelLongPress() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }

  function checkMove(e: React.PointerEvent) {
    if (!longPressTimer.current) return;
    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;
    if (dx * dx + dy * dy > 100) cancelLongPress(); // >10px = scroll, not hold
  }

  function handleCaptionClick() {
    if (longPressActivated.current) { longPressActivated.current = false; return; }
  }

  function fetchShareUrl(): Promise<string | null> {
    return fetch("/api/admin/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) return `ERROR ${r.status}: ${data?.error ?? "unknown"}`;
        prefetchedShareUrl.current = data?.shareUrl ?? null;
        return data?.shareUrl ?? null;
      })
      .catch((e) => `ERROR: ${e}`);
  }

  function handleShare() {
    setShowActionSheet(false);
    if (!isAdmin) {
      // Use the live origin so the link matches the domain in use, not a
      // possibly-stale NEXT_PUBLIC_SITE_URL.
      const origin =
        typeof window !== "undefined" ? window.location.origin : siteUrl;
      const postUrl = `${origin}/posts/${slug}`;
      const body = `${postUrl}\n\nMy reaction:\n`;
      window.location.href = `sms:${recipients.join(",")}&body=${encodeURIComponent(body)}`;
      return;
    }

    const cachedUrl = prefetchedShareUrl.current;
    if (cachedUrl) {
      // URL already in memory — navigator.share called synchronously within
      // the tap handler, satisfying iOS's user gesture requirement
      if ('share' in navigator) {
        (navigator as Navigator & { share: (d: ShareData) => Promise<void> })
          .share({ url: cachedUrl, title: title ?? undefined })
          .catch(() => setShareLink(cachedUrl));
      } else {
        setShareLink(cachedUrl);
      }
    } else {
      // Pre-fetch not done yet — async fallback to copy sheet
      setShareLinkLoading(true);
      setShareLink(null);
      const p = sharePromise.current ?? fetchShareUrl();
      p.then((resolved) => {
        setShareLinkLoading(false);
        setShareLink(resolved ?? "ERROR: no URL returned");
      });
    }
  }

  async function copyShareLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => { setShareLink(null); setCopied(false); }, 1500);
    } catch {
      // clipboard blocked — user can copy from the displayed URL
    }
  }

  return (
    <>
      <div
        className={className}
        onClick={handleCaptionClick}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerMove={checkMove}
        onContextMenu={(e) => { e.preventDefault(); cancelLongPress(); openSheet(); }}
      >
        {children}
      </div>

      {/* Action sheet — long-press / right-click to reveal */}
      {showActionSheet && (
        <div
          className="fixed inset-0 z-50 bg-black/50"
          onClick={() => setShowActionSheet(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-[#232222] rounded-t-2xl overflow-hidden pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-[#444] rounded-full mx-auto mt-3 mb-2" />
            {viewPostHref && (
              <Link
                href={viewPostHref}
                className="flex items-center w-full px-6 py-4 text-[#d3d3d3] hover:bg-[#2a2929] text-base"
                onClick={() => setShowActionSheet(false)}
              >
                View post
              </Link>
            )}
            {isAdmin && (
              <Link
                href={`/admin/posts/${postId}/edit`}
                className={`flex items-center w-full px-6 py-4 text-[#d3d3d3] hover:bg-[#2a2929] text-base${viewPostHref ? " border-t border-[#2a2929]" : ""}`}
                onClick={() => setShowActionSheet(false)}
              >
                Edit post
              </Link>
            )}
            <button
              onClick={handleShare}
              className={`flex items-center w-full px-6 py-4 text-[#d3d3d3] hover:bg-[#2a2929] text-base${isAdmin || viewPostHref ? " border-t border-[#2a2929]" : ""}`}
            >
              Share
            </button>
            <button
              onClick={() => setShowActionSheet(false)}
              className="flex items-center w-full px-6 py-4 text-[#666] hover:bg-[#2a2929] text-base border-t border-[#2a2929]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Share link sheet */}
      {(shareLink !== null || shareLinkLoading) && (
        <div
          className="fixed inset-0 z-50 bg-black/50"
          onClick={() => { setShareLink(null); setShareLinkLoading(false); setCopied(false); }}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-[#232222] rounded-t-2xl overflow-hidden pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-[#444] rounded-full mx-auto mt-3 mb-4" />
            <div className="px-6 mb-2">
              <p className="text-[#555] text-xs uppercase tracking-wide mb-2">Share link · expires in 30 days</p>
              {shareLinkLoading && (
                <p className="text-[#555] text-xs bg-[#1a1a1a] rounded px-3 py-2">Generating link…</p>
              )}
              {shareLink && shareLink.startsWith("ERROR") && (
                <p className="text-[#884444] text-xs bg-[#1a1a1a] rounded px-3 py-2 break-all">{shareLink}</p>
              )}
            </div>
            {shareLink && !shareLink.startsWith("ERROR") && 'share' in navigator && (
              <button
                onClick={() => (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({ url: shareLink!, title: title ?? undefined })}
                className="flex items-center w-full px-6 py-4 text-[#d3d3d3] hover:bg-[#2a2929] text-base"
              >
                Share…
              </button>
            )}
            {shareLink && !shareLink.startsWith("ERROR") && (
              <button
                onClick={copyShareLink}
                className={`flex items-center w-full px-6 py-4 text-[#d3d3d3] hover:bg-[#2a2929] text-base${'share' in navigator ? " border-t border-[#2a2929]" : ""}`}
              >
                {copied ? "Copied!" : "Copy link"}
              </button>
            )}
            <button
              onClick={() => { setShareLink(null); setShareLinkLoading(false); setCopied(false); }}
              className={`flex items-center w-full px-6 py-4 text-[#666] hover:bg-[#2a2929] text-base${shareLink && !shareLink.startsWith("ERROR") ? " border-t border-[#2a2929]" : ""}`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
