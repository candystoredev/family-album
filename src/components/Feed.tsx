"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import PhotoGrid from "./PhotoGrid";
import Lightbox from "./Lightbox";
import OnThisDay from "./OnThisDay";

interface MediaItem {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
}

interface Post {
  id: string;
  slug: string;
  title: string | null;
  body: string | null;
  date: string;
  type: string;
  photoset_layout: string | null;
  media: MediaItem[];
  tags?: { name: string; slug: string }[];
  people?: { name: string; slug: string }[];
}

interface FeedProps {
  initialPosts: Post[];
  initialCursor: string | null;
  siteUrl: string;
  imessageRecipients: string;
  filterParams?: string;
  isAdmin?: boolean;
}

const END_MESSAGES = [
  "You\u2019ve reached the beginning",
  "That\u2019s every memory so far",
  "Time to make new ones \u2764\uFE0F",
  "You scrolled all the way back. Impressive.",
  "The beginning of us",
  "That\u2019s where it all started",
  "No more scrolling \u2014 go make some memories!",
  "You\u2019ve seen it all. For now.",
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Skeleton placeholder for a loading post */
function PostSkeleton() {
  return (
    <div>
      <div className="skeleton-shimmer rounded-lg h-[300px] sm:h-[400px] -mx-4 sm:mx-0 sm:rounded-lg" />
      <div className="mt-4 px-4 sm:px-8 flex flex-col items-center gap-2">
        <div className="skeleton-shimmer h-3 w-32 rounded" />
        <div className="skeleton-shimmer h-2.5 w-20 rounded" />
      </div>
    </div>
  );
}

export default function Feed({
  initialPosts,
  initialCursor,
  siteUrl,
  imessageRecipients,
  filterParams,
  isAdmin,
}: FeedProps) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Prefetch state
  const prefetchedRef = useRef<{ posts: Post[]; nextCursor: string | null } | null>(null);
  const prefetchingRef = useRef(false);

  // Lightbox state
  const [lightbox, setLightbox] = useState<{
    media: MediaItem[];
    index: number;
  } | null>(null);

  // Pick a random end message on mount
  const endMessage = useMemo(
    () => END_MESSAGES[Math.floor(Math.random() * END_MESSAGES.length)],
    []
  );

  const buildUrl = useCallback(
    (c: string) => {
      const params = new URLSearchParams();
      params.set("cursor", c);
      if (filterParams) {
        const extra = new URLSearchParams(filterParams);
        extra.forEach((v, k) => params.set(k, v));
      }
      return `/api/feed?${params.toString()}`;
    },
    [filterParams]
  );

  // Prefetch the next page ahead of time
  const prefetchNext = useCallback(
    async (nextCursor: string | null) => {
      if (!nextCursor || prefetchingRef.current) return;
      prefetchingRef.current = true;
      try {
        const res = await fetch(buildUrl(nextCursor));
        if (res.ok) {
          prefetchedRef.current = await res.json();
        }
      } catch {
        // Silent fail — will fetch normally when needed
      } finally {
        prefetchingRef.current = false;
      }
    },
    [buildUrl]
  );

  const fetchMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      // Use prefetched data if available
      if (prefetchedRef.current) {
        const data = prefetchedRef.current;
        prefetchedRef.current = null;
        setPosts((prev) => [...prev, ...data.posts]);
        setCursor(data.nextCursor);
        prefetchNext(data.nextCursor);
      } else {
        const res = await fetch(buildUrl(cursor));
        if (!res.ok) return;
        const data = await res.json();
        setPosts((prev) => [...prev, ...data.posts]);
        setCursor(data.nextCursor);
        prefetchNext(data.nextCursor);
      }
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, buildUrl, prefetchNext]);

  // Start prefetching first next page on mount
  useEffect(() => {
    if (initialCursor) {
      prefetchNext(initialCursor);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchMore();
        }
      },
      { rootMargin: "600px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchMore]);

  if (posts.length === 0) return null;

  const recipients = imessageRecipients
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  return (
    <>
      {/* On this day — only show on main feed (no filters) */}
      {!filterParams && <OnThisDay />}

      <div className="space-y-6">
        {posts.map((post, postIndex) => (
          <PostCard
            key={post.id}
            post={post}
            postIndex={postIndex}
            recipients={recipients}
            siteUrl={siteUrl}
            isAdmin={isAdmin}
            onLightbox={(index) =>
              setLightbox({ media: post.media, index })
            }
          />
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-px" />

      {loading && (
        <div className="space-y-12 py-8">
          <PostSkeleton />
          <PostSkeleton />
        </div>
      )}

      {!cursor && posts.length > 0 && (
        <p className="text-center text-[#444] text-xs py-12 tracking-wide uppercase">
          {endMessage}
        </p>
      )}

      {/* Lightbox overlay */}
      {lightbox && (
        <Lightbox
          media={lightbox.media}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

/** Individual post card */
function PostCard({
  post,
  postIndex,
  recipients,
  siteUrl,
  isAdmin,
  onLightbox,
}: {
  post: Post;
  postIndex: number;
  recipients: string[];
  siteUrl: string;
  isAdmin?: boolean;
  onLightbox: (index: number) => void;
}) {
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareLinkLoading, setShareLinkLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActivated = useRef(false);
  const pointerStart = useRef({ x: 0, y: 0 });
  // Pre-fetched share URL — populated while action sheet is open so Share tap is synchronous
  const prefetchedShareUrl = useRef<string | null>(null);
  const sharePromise = useRef<Promise<string | null> | null>(null);

  function startLongPress(e: React.PointerEvent) {
    pointerStart.current = { x: e.clientX, y: e.clientY };
    longPressActivated.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressActivated.current = true;
      setShowActionSheet(true);
      if (navigator.vibrate) navigator.vibrate(20);
      // Kick off share token fetch while user reads the action sheet,
      // so the URL is ready by the time they tap Share.
      if (isAdmin) {
        prefetchedShareUrl.current = null;
        sharePromise.current = fetchShareUrl();
      }
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
      body: JSON.stringify({ postId: post.id }),
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
      const postUrl = `${siteUrl}/posts/${post.slug}`;
      const body = `${postUrl}\n\nMy reaction:\n`;
      window.location.href = `sms:${recipients.join(",")}&body=${encodeURIComponent(body)}`;
      return;
    }

    // Show the sheet immediately so there's visible feedback
    const cachedUrl = prefetchedShareUrl.current;
    if (cachedUrl) {
      setShareLink(cachedUrl);
    } else {
      setShareLinkLoading(true);
      setShareLink(null);
      const p = sharePromise.current ?? fetchShareUrl();
      p.then((resolved) => {
        setShareLinkLoading(false);
        setShareLink(resolved ?? "error");
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
    <article className={postIndex > 0 ? "mt-10" : ""}>
      {/* Media — bleed to screen edge on mobile */}
      {post.media.length > 0 && (
        <div className="-mx-4 sm:mx-0">
          <PhotoGrid
            media={post.media}
            layout={post.photoset_layout}
            onImageClick={(index) => onLightbox(index)}
          />
        </div>
      )}

      {/* Caption area — 500ms hold opens action sheet for all users */}
      <div
        className="mt-4 px-4 sm:px-8 relative flex items-center select-none"
        onClick={handleCaptionClick}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerMove={checkMove}
        onContextMenu={isAdmin ? (e) => { e.preventDefault(); cancelLongPress(); setShowActionSheet(true); } : undefined}
      >
        <div className="text-center flex-1">
          {post.title && (
            <h2 className="text-[#e0e0e0] text-lg font-medium leading-snug mb-1.5">
              {post.title}
            </h2>
          )}
          {post.body && (
            <div
              className="text-[#a0a0a0] text-sm leading-relaxed mb-2 text-left post-body"
              dangerouslySetInnerHTML={{ __html: post.body }}
            />
          )}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <time className="text-[#555] text-xs tracking-wide uppercase">
              {formatDate(post.date)}
            </time>
            {isAdmin && <PostMeta tags={post.tags} people={post.people} />}
          </div>
        </div>

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
            {isAdmin && (
              <Link
                href={`/admin/posts/${post.id}/edit`}
                className="flex items-center w-full px-6 py-4 text-[#d3d3d3] hover:bg-[#2a2929] text-base"
                onClick={() => setShowActionSheet(false)}
              >
                Edit post
              </Link>
            )}
            <button
              onClick={handleShare}
              className={`flex items-center w-full px-6 py-4 text-[#d3d3d3] hover:bg-[#2a2929] text-base${isAdmin ? " border-t border-[#2a2929]" : ""}`}
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
              {shareLink && !shareLink.startsWith("ERROR") && (
                <p className="text-[#888] text-xs break-all bg-[#1a1a1a] rounded px-3 py-2">{shareLink}</p>
              )}
            </div>
            {shareLink && !shareLink.startsWith("ERROR") && (
              <button
                onClick={copyShareLink}
                className="flex items-center w-full px-6 py-4 text-[#d3d3d3] hover:bg-[#2a2929] text-base"
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
    </article>
  );
}

/** Tags and people links below the date */
function PostMeta({
  tags,
  people,
}: {
  tags?: { name: string; slug: string }[];
  people?: { name: string; slug: string }[];
}) {
  const hasTags = tags && tags.length > 0;
  const hasPeople = people && people.length > 0;
  if (!hasTags && !hasPeople) return null;

  return (
    <span className="inline-flex flex-wrap gap-x-1.5 text-xs">
      {hasPeople &&
        people.map((p) => (
          <Link
            key={p.slug}
            href={`/people/${p.slug}`}
            className="text-[#4a4a4a] hover:text-[#777] transition-colors"
          >
            @{p.name}
          </Link>
        ))}
      {hasTags &&
        tags.map((t) => (
          <Link
            key={t.slug}
            href={`/tags/${t.slug}`}
            className="text-[#4a4a4a] hover:text-[#777] transition-colors"
          >
            #{t.name}
          </Link>
        ))}
    </span>
  );
}

