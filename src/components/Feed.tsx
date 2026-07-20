"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import PhotoGrid from "./PhotoGrid";
import Lightbox from "./Lightbox";
import OnThisDay from "./OnThisDay";
import PostActions from "./PostActions";
import { formatDisplayDate, isEstimatedDate } from "@/lib/datetime";

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
  local_date?: string | null;
  date_source?: string | null;
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

  // Re-sync to a fresh server payload (router.refresh() / soft navigation).
  // `initialPosts` only gets a new identity when the server component actually
  // re-renders, so this never fires on our own setPosts calls (infinite scroll).
  // We overlay the fresh first page — reflecting edits, new posts and reordering
  // — while keeping any older pages the user has already scrolled in, so a
  // background refresh doesn't collapse the feed or jump their scroll position.
  useEffect(() => {
    setPosts((prev) => {
      const freshIds = new Set(initialPosts.map((p) => p.id));
      const olderTail = prev.filter((p) => !freshIds.has(p.id));
      return [...initialPosts, ...olderTail];
    });
  }, [initialPosts]);

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
      <PostActions
        postId={post.id}
        slug={post.slug}
        title={post.title}
        isAdmin={isAdmin}
        recipients={recipients}
        siteUrl={siteUrl}
        className="mt-4 px-4 sm:px-8 relative flex items-center select-none"
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
              {formatDisplayDate(post.date, post.local_date)}
            </time>
            {isEstimatedDate(post.date_source) && (
              <span
                className="text-[#555] text-[10px] tracking-wide uppercase border border-[#333] rounded px-1 py-px"
                title="Date estimated — no capture metadata was found, so this is a best guess."
              >
                est.
              </span>
            )}
            {isAdmin && <PostMeta tags={post.tags} people={post.people} />}
          </div>
        </div>
      </PostActions>
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

