"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import PhotoGrid from "./PhotoGrid";
import Lightbox from "./Lightbox";

interface MediaItem {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
}

interface OnThisDayPost {
  slug: string;
  title: string | null;
  body: string | null;
  date: string;
  photosetLayout: string | null;
  thumbnailUrl: string | null;
  media: MediaItem[];
}

export default function OnThisDay() {
  const [posts, setPosts] = useState<OnThisDayPost[]>([]);
  const [expanded, setExpanded] = useState(false);
  // Index of selected memory (-1 = thumbnail row, 0+ = viewing that post)
  const [activeIndex, setActiveIndex] = useState(-1);
  const [lightbox, setLightbox] = useState<{ media: MediaItem[]; index: number } | null>(null);
  // Swipe state for navigating between memories
  const [swipeOffsetX, setSwipeOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const skipTransition = useRef(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchDeltaX = useRef(0);
  const touchMoved = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const postContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    fetch(`/api/on-this-day?month=${month}&day=${day}`)
      .then((r) => (r.ok ? r.json() : { posts: [] }))
      .then((data) => setPosts(data.posts || []))
      .catch(() => {});
  }, []);

  function openMemory(i: number) {
    setActiveIndex(i);
  }

  function closeEverything() {
    setActiveIndex(-1);
    setExpanded(false);
    setSwipeOffsetX(0);
  }

  const goNextMemory = useCallback(() => {
    if (activeIndex < posts.length - 1 && !isTransitioning) {
      setIsTransitioning(true);
      setSwipeOffsetX(-(containerRef.current?.clientWidth || window.innerWidth));
      setTimeout(() => {
        skipTransition.current = true;
        setActiveIndex((i) => i + 1);
        setSwipeOffsetX(0);
        setIsTransitioning(false);
        requestAnimationFrame(() => { skipTransition.current = false; });
      }, 300);
    }
  }, [activeIndex, posts.length, isTransitioning]);

  const goPrevMemory = useCallback(() => {
    if (activeIndex > 0 && !isTransitioning) {
      setIsTransitioning(true);
      setSwipeOffsetX(containerRef.current?.clientWidth || window.innerWidth);
      setTimeout(() => {
        skipTransition.current = true;
        setActiveIndex((i) => i - 1);
        setSwipeOffsetX(0);
        setIsTransitioning(false);
        requestAnimationFrame(() => { skipTransition.current = false; });
      }, 300);
    }
  }, [activeIndex, isTransitioning]);

  // Touch handlers for swiping between memories
  function onTouchStart(e: React.TouchEvent) {
    if (activeIndex < 0) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchDeltaX.current = 0;
    touchMoved.current = false;
    setIsSwiping(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    if (activeIndex < 0) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    touchDeltaX.current = dx;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) touchMoved.current = true;
    if (Math.abs(dx) > Math.abs(dy)) {
      setSwipeOffsetX(dx);
    }
  }

  function onTouchEnd() {
    if (activeIndex < 0) return;
    setIsSwiping(false);
    const threshold = 60;
    const dx = touchDeltaX.current;
    if (dx < -threshold && activeIndex < posts.length - 1 && !isTransitioning) {
      goNextMemory();
    } else if (dx > threshold && activeIndex > 0 && !isTransitioning) {
      goPrevMemory();
    } else {
      setSwipeOffsetX(0);
    }
  }

  // Wheel handler for desktop trackpad swipe
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onWheel(e: React.WheelEvent) {
    if (activeIndex < 0 || posts.length <= 1) return;
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    wheelAccum.current += e.deltaX;
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
    wheelTimer.current = setTimeout(() => { wheelAccum.current = 0; }, 200);
    const threshold = 80;
    if (wheelAccum.current > threshold) {
      wheelAccum.current = 0;
      goNextMemory();
    } else if (wheelAccum.current < -threshold) {
      wheelAccum.current = 0;
      goPrevMemory();
    }
  }

  if (posts.length === 0) return null;

  const count = posts.length;
  const label = count === 1 ? "1 memory" : `${count} memories`;
  const isViewing = activeIndex >= 0;
  const isOpen = expanded || isViewing;

  // Incoming memory for swipe transition
  const incomingIdx = swipeOffsetX < 0 && activeIndex < posts.length - 1
    ? activeIndex + 1
    : swipeOffsetX > 0 && activeIndex > 0
    ? activeIndex - 1
    : null;

  return (
    <div className="mb-8">
      {/* Compact teaser bar */}
      <button
        onClick={() => {
          if (isOpen) {
            closeEverything();
          } else {
            setExpanded(true);
          }
        }}
        className="w-full flex items-center gap-3 px-4 sm:px-0 group"
      >
        {/* Thumbnail peek */}
        <div className="flex -space-x-2 shrink-0">
          {posts.slice(0, 3).map((post, i) =>
            post.thumbnailUrl ? (
              <img
                key={post.slug}
                src={post.thumbnailUrl}
                alt=""
                className="w-8 h-8 rounded-full object-cover border-2 border-[#1d1c1c]"
                style={{ zIndex: 3 - i }}
              />
            ) : (
              <div
                key={post.slug}
                className="w-8 h-8 rounded-full bg-[#333] border-2 border-[#1d1c1c]"
                style={{ zIndex: 3 - i }}
              />
            )
          )}
        </div>

        <span className="text-[#888] text-sm group-hover:text-[#aaa] transition-colors">
          <span className="text-[#d3d3d3] group-hover:text-white transition-colors">
            On this day
          </span>
          {" \u00B7 "}
          {label} from years past
        </span>

        {/* Chevron when closed, X when open */}
        {isOpen ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="w-4 h-4 text-[#555] ml-auto shrink-0"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="w-4 h-4 text-[#555] ml-auto shrink-0"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {/* Expandable area */}
      <div
        className={`transition-all duration-300 ease-out ${
          isOpen ? "mt-3" : "mt-0"
        }`}
        style={{
          display: "grid",
          gridTemplateRows: isOpen ? "1fr" : "0fr",
          opacity: isOpen ? 1 : 0,
          transition: "grid-template-rows 0.45s cubic-bezier(0.22, 0.68, 0, 1.0), opacity 0.3s ease-out, margin 0.3s ease-out",
        }}
      >
        {/* sm:-mx-6 sm:px-6 extends the overflow boundary so nav buttons aren't clipped */}
        <div className={`overflow-hidden ${isViewing ? "sm:-mx-6 sm:px-6" : ""}`}>
        {/* Thumbnail card row — fades out when viewing */}
        <div
          style={{
            height: isViewing ? 0 : "auto",
            opacity: isViewing ? 0 : 1,
            overflow: "hidden",
            transition: "height 0.35s ease-out, opacity 0.25s ease-out",
          }}
        >
          <div className="flex gap-3 px-4 sm:px-0 overflow-x-auto pb-2 scrollbar-hide touch-pan-x">
            {posts.map((post, i) => {
              const d = new Date(post.date);
              const yearsAgo = new Date().getFullYear() - d.getFullYear();
              const timeLabel =
                yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
              return (
                <button
                  key={post.slug}
                  onClick={() => openMemory(i)}
                  className="shrink-0 group/card active:scale-95 transition-transform text-left"
                >
                  <div className="w-36 rounded-lg overflow-hidden bg-[#252424] border border-[#333] group-hover/card:border-[#555] transition-colors">
                    {post.thumbnailUrl ? (
                      <img
                        src={post.thumbnailUrl}
                        alt=""
                        className="w-36 h-24 object-cover"
                      />
                    ) : (
                      <div className="w-36 h-24 bg-[#333]" />
                    )}
                    <div className="px-2.5 py-2">
                      <p className="text-[#d3d3d3] text-xs leading-tight truncate group-hover/card:text-white transition-colors">
                        {post.title || timeLabel}
                      </p>
                      <p className="text-[#555] text-[11px] mt-0.5">{timeLabel}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Expanded memory view — swipeable between posts */}
        {isViewing && (
          <div className="relative w-full min-w-0">
            {/* Swipe container — clips content horizontally */}
            <div
              ref={containerRef}
              className="overflow-hidden w-full"
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onWheel={onWheel}
            >
              {/* Incoming memory (swipe transition) */}
              {incomingIdx !== null && (swipeOffsetX !== 0 || isTransitioning) && (
                <div
                  className="absolute inset-0"
                  style={{
                    transform: `translateX(${swipeOffsetX < 0 ? swipeOffsetX + (containerRef.current?.clientWidth || window.innerWidth) : swipeOffsetX - (containerRef.current?.clientWidth || window.innerWidth)}px)`,
                    transition: isSwiping || skipTransition.current
                      ? "none"
                      : "transform 0.3s cubic-bezier(0.22, 0.68, 0, 1.0)",
                  }}
                >
                  <MemoryCard post={posts[incomingIdx]} onImageClick={() => {}} />
                </div>
              )}

              {/* Current memory */}
              <div
                ref={postContentRef}
                className="w-full min-w-0"
                style={{
                  transform: swipeOffsetX !== 0 ? `translateX(${swipeOffsetX}px)` : undefined,
                  transition: isSwiping || skipTransition.current
                    ? "none"
                    : "transform 0.3s cubic-bezier(0.22, 0.68, 0, 1.0)",
                }}
              >
                <MemoryCard
                  post={posts[activeIndex]}
                  onImageClick={(idx) => setLightbox({ media: posts[activeIndex].media, index: idx })}
                />
              </div>
            </div>

            {/* Desktop nav arrows — straddle the post edge (half on photo, half off) */}
            {posts.length > 1 && (
              <>
                {activeIndex > 0 && (
                  <button
                    onClick={goPrevMemory}
                    className="hidden sm:flex absolute -left-5 top-1/3 z-10 w-10 h-10 rounded-full bg-[#252424]/90 border border-[#333] shadow-lg shadow-black/40 items-center justify-center text-[#888] hover:text-white hover:border-[#555] transition-colors backdrop-blur-sm"
                    aria-label="Previous memory"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                )}
                {activeIndex < posts.length - 1 && (
                  <button
                    onClick={goNextMemory}
                    className="hidden sm:flex absolute -right-5 top-1/3 z-10 w-10 h-10 rounded-full bg-[#252424]/90 border border-[#333] shadow-lg shadow-black/40 items-center justify-center text-[#888] hover:text-white hover:border-[#555] transition-colors backdrop-blur-sm"
                    aria-label="Next memory"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </button>
                )}
              </>
            )}

            {/* Dot indicators */}
            {posts.length > 1 && (
              <div className="flex justify-center gap-1.5 mt-4 pb-1">
                {posts.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSwipeOffsetX(0);
                      setActiveIndex(i);
                    }}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      i === activeIndex ? "bg-white" : "bg-white/20"
                    }`}
                    aria-label={`Memory ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Image lightbox */}
      {lightbox && (
        <Lightbox
          media={lightbox.media}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

/** A single memory card showing the post's photos, caption, and date */
function MemoryCard({
  post,
  onImageClick,
}: {
  post: OnThisDayPost;
  onImageClick: (index: number) => void;
}) {
  const d = new Date(post.date);
  const yearsAgo = new Date().getFullYear() - d.getFullYear();
  const timeLabel = yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
  const dateFormatted = d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="px-1 sm:px-0 w-full min-w-0">
      <div className="rounded-lg overflow-hidden bg-[#252424] border border-[#333]">
        {/* Photos */}
        {post.media.length > 0 && (
          <div className="rounded-t-lg overflow-hidden">
            <PhotoGrid
              media={post.media}
              layout={post.photosetLayout}
              onImageClick={onImageClick}
            />
          </div>
        )}

        {/* Caption & date — centered */}
        <div className="px-4 py-3 text-center">
          <p className="text-[#888] text-xs mb-1">{timeLabel} &middot; {dateFormatted}</p>
          {post.title && (
            <p className="text-[#e0e0e0] text-sm font-medium leading-snug mb-1">
              {post.title}
            </p>
          )}
          {post.body && (
            <div
              className="text-[#a0a0a0] text-sm leading-relaxed post-body line-clamp-4"
              dangerouslySetInnerHTML={{ __html: post.body }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
