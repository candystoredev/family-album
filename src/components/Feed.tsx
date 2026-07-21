"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PhotoGrid from "./PhotoGrid";
import Lightbox from "./Lightbox";
import OnThisDay from "./OnThisDay";
import PostActions from "./PostActions";
import { formatDisplayDate, isEstimatedDate } from "@/lib/datetime";
import { broadcastSelectMode } from "@/lib/selectModeBroadcast";

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

interface TagOption {
  id: string;
  name: string;
  slug: string;
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
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Bulk-tag select mode (admin). Selection is keyed by post id, so it keeps
  // working across newly loaded infinite-scroll pages.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showTagSheet, setShowTagSheet] = useState(false);
  const [allTags, setAllTags] = useState<TagOption[]>([]);
  const tagsFetchedRef = useRef(false);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Tell ArchiveMenu (mounted in the root layout, a separate React tree) to
  // hide the gold FAB while select mode is active — it otherwise overlaps
  // the bottom bar below. Force an exit signal on unmount too, in case Feed
  // goes away mid-select (e.g. navigation) without selectMode ever flipping
  // back to false.
  useEffect(() => {
    broadcastSelectMode(selectMode);
    return () => {
      if (selectMode) broadcastSelectMode(false);
    };
  }, [selectMode]);

  // Entering select mode pre-selects the post whose action sheet launched it.
  const enterSelectMode = useCallback((postId: string) => {
    setSelectMode(true);
    setSelectedIds(new Set([postId]));
  }, []);

  const toggleSelect = useCallback((postId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setShowTagSheet(false);
    setBulkTags([]);
    setNewTag("");
    setApplyError(null);
  }, []);

  function openTagSheet() {
    setApplyError(null);
    setShowTagSheet(true);
    // Fetch the tag vocabulary once, the first time the sheet opens.
    if (!tagsFetchedRef.current) {
      tagsFetchedRef.current = true;
      fetch("/api/admin/tags")
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setAllTags(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }

  function addBulkTag(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!bulkTags.includes(trimmed)) setBulkTags([...bulkTags, trimmed]);
    setNewTag("");
  }

  async function applyTags() {
    if (selectedIds.size === 0 || bulkTags.length === 0 || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await fetch("/api/admin/posts/bulk-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postIds: [...selectedIds], tags: bulkTags }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setApplyError(data?.error ?? "Failed to apply tags");
        return;
      }
      exitSelectMode();
      // Re-sync the server payload so the newly tagged posts reflect it (the
      // initialPosts effect above overlays the fresh first page).
      router.refresh();
    } catch {
      setApplyError("Failed to apply tags");
    } finally {
      setApplying(false);
    }
  }

  const tagAutocomplete = allTags.filter(
    (t) =>
      !bulkTags.includes(t.name) &&
      t.name.toLowerCase().includes(newTag.toLowerCase()) &&
      newTag.length > 0
  );

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
            selectMode={selectMode}
            selected={selectedIds.has(post.id)}
            onEnterSelect={enterSelectMode}
            onToggleSelect={toggleSelect}
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

      {/* Select-mode bottom bar — spacer keeps the last post clear of the bar */}
      {selectMode && (
        <>
          <div className="h-24" aria-hidden />
          <div className="fixed bottom-0 inset-x-0 z-40 bg-[#232222] rounded-t-2xl px-6 pt-4 pb-8 flex items-center justify-between">
            <span className="text-[#a0a0a0] text-sm">{selectedIds.size} selected</span>
            <div className="flex items-center gap-2">
              <button
                onClick={openTagSheet}
                disabled={selectedIds.size === 0}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[#c2a467] text-[#1a1715] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add tags
              </button>
              <button
                onClick={exitSelectMode}
                className="px-4 py-2 rounded-lg text-sm text-[#a0a0a0] hover:bg-[#2a2929]"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Add-tags sheet */}
      {showTagSheet && (
        <div
          className="fixed inset-0 z-50 bg-black/50"
          onClick={() => setShowTagSheet(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-[#232222] rounded-t-2xl overflow-hidden pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-[#444] rounded-full mx-auto mt-3 mb-4" />
            <div className="px-6 space-y-3">
              {/* Selected-tag chips */}
              {bulkTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {bulkTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-[#2a2929] rounded text-sm text-[#a0a0a0]"
                    >
                      #{tag}
                      <button
                        onClick={() => setBulkTags(bulkTags.filter((t) => t !== tag))}
                        className="text-[#666] hover:text-[#d86d6d] ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {/* Tag input + autocomplete */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Add tag..."
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newTag.trim()) {
                      e.preventDefault();
                      addBulkTag(newTag);
                    }
                  }}
                  className="w-full bg-[#2a2929] rounded-lg px-4 py-2.5 text-sm text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3]"
                />
                {tagAutocomplete.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 bottom-full mb-1 bg-[#2a2929] rounded-lg border border-[#3a3939] max-h-40 overflow-y-auto">
                    {tagAutocomplete.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => addBulkTag(t.name)}
                        className="w-full text-left px-4 py-2 text-sm text-[#a0a0a0] hover:bg-[#333] hover:text-[#d3d3d3]"
                      >
                        #{t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {applyError && <p className="text-[#d86d6d] text-sm">{applyError}</p>}
              <button
                onClick={applyTags}
                disabled={bulkTags.length === 0 || applying}
                className="w-full bg-[#c2a467] text-[#1a1715] rounded-lg px-4 py-3 text-base font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {applying ? "Applying…" : `Apply to ${selectedIds.size} post${selectedIds.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
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
  selectMode,
  selected,
  onEnterSelect,
  onToggleSelect,
  onLightbox,
}: {
  post: Post;
  postIndex: number;
  recipients: string[];
  siteUrl: string;
  isAdmin?: boolean;
  selectMode: boolean;
  selected: boolean;
  onEnterSelect: (postId: string) => void;
  onToggleSelect: (postId: string) => void;
  onLightbox: (index: number) => void;
}) {
  return (
    <article className={`relative${postIndex > 0 ? " mt-10" : ""}${selected ? " ring-2 ring-[#c2a467] rounded-lg" : ""}`}>
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
        onSelectPosts={() => onEnterSelect(post.id)}
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

      {/* Select-mode overlay — a full-card click target above everything else in
          the article, so tapping toggles selection instead of opening the
          lightbox or the long-press sheet. */}
      {selectMode && (
        <div
          className="absolute inset-y-0 -inset-x-4 sm:inset-x-0 z-30 cursor-pointer"
          onClick={() => onToggleSelect(post.id)}
        >
          <div className="absolute top-3 right-3">
            {selected ? (
              <div className="w-7 h-7 rounded-full bg-[#c2a467] flex items-center justify-center shadow">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="#1a1715" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
            ) : (
              <div className="w-7 h-7 rounded-full border-2 border-white/70 bg-black/25" />
            )}
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

