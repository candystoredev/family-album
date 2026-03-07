"use client";

import { useEffect, useCallback, useRef, useState } from "react";

interface MediaItem {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
}

interface LightboxProps {
  media: MediaItem[];
  initialIndex: number;
  onClose: () => void;
}

/** Preload an image and return a promise that resolves when loaded */
function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve(); // resolve anyway so we don't block
    img.src = url;
  });
}

export default function Lightbox({
  media,
  initialIndex,
  onClose,
}: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchDeltaX = useRef(0);
  const touchMoved = useRef(false);
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  const count = media.length;
  const current = media[index];

  // Determine which incoming image to show behind the current one during swipe
  const incomingIndex = offsetX < 0 && index < count - 1
    ? index + 1
    : offsetX > 0 && index > 0
    ? index - 1
    : null;
  const incoming = incomingIndex !== null ? media[incomingIndex] : null;

  const goNext = useCallback(() => {
    if (index < count - 1 && !transitioning) {
      setTransitioning(true);
      setOffsetX(-window.innerWidth);
      setTimeout(() => {
        setIndex((i) => i + 1);
        setOffsetX(0);
        setTransitioning(false);
      }, 300);
    }
  }, [index, count, transitioning]);

  const goPrev = useCallback(() => {
    if (index > 0 && !transitioning) {
      setTransitioning(true);
      setOffsetX(window.innerWidth);
      setTimeout(() => {
        setIndex((i) => i - 1);
        setOffsetX(0);
        setTransitioning(false);
      }, 300);
    }
  }, [index, transitioning]);

  // Preload current image + adjacent images
  useEffect(() => {
    const toPreload = [index - 1, index, index + 1]
      .filter((i) => i >= 0 && i < count)
      .map((i) => media[i])
      .filter((m) => m.type !== "video" && !loaded.has(m.id));

    for (const m of toPreload) {
      preloadImage(m.url).then(() => {
        setLoaded((prev) => new Set(prev).add(m.id));
      });
    }
  }, [index, count, media, loaded]);

  // Preload ALL images on mount (start with current, then fan out)
  useEffect(() => {
    const ordered = [initialIndex];
    for (let offset = 1; offset < count; offset++) {
      if (initialIndex + offset < count) ordered.push(initialIndex + offset);
      if (initialIndex - offset >= 0) ordered.push(initialIndex - offset);
    }
    for (const i of ordered) {
      const m = media[i];
      if (m.type !== "video") {
        preloadImage(m.url).then(() => {
          setLoaded((prev) => new Set(prev).add(m.id));
        });
      }
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goNext, goPrev]);

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Touch handlers for swipe
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchDeltaX.current = 0;
    touchMoved.current = false;
    setSwiping(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    touchDeltaX.current = dx;

    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      touchMoved.current = true;
    }

    // Only track horizontal swipe if it's more horizontal than vertical
    if (Math.abs(dx) > Math.abs(dy)) {
      setOffsetX(dx);
    }
  }

  function onTouchEnd() {
    setSwiping(false);
    const threshold = 60;
    const dx = touchDeltaX.current;
    if (dx < -threshold && index < count - 1 && !transitioning) {
      goNext();
    } else if (dx > threshold && index > 0 && !transitioning) {
      goPrev();
    } else {
      setOffsetX(0);
    }
  }

  // Close when clicking backdrop (not on the image itself)
  function onBackdropClick(e: React.MouseEvent) {
    // Only close if click was directly on the backdrop, not on the image/video
    const target = e.target as HTMLElement;
    if (
      target.tagName !== "IMG" &&
      target.tagName !== "VIDEO" &&
      !target.closest("button")
    ) {
      // On touch devices, don't close if the user was swiping
      if (!touchMoved.current) {
        onClose();
      }
    }
  }

  const isCurrentLoaded = current.type === "video" || loaded.has(current.id);

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Top bar — overlays image */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3">
        {count > 1 && (
          <span className="text-white/60 text-sm">
            {index + 1} / {count}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="text-white/70 hover:text-white p-1 transition-colors"
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-7 h-7">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Image area — full screen, no padding */}
      <div
        className="flex-1 flex items-center justify-center min-h-0 relative overflow-hidden"
        onClick={onBackdropClick}
      >
        {/* Previous arrow — desktop only */}
        {index > 0 && (
          <button
            onClick={goPrev}
            className="hidden sm:flex absolute left-3 z-10 text-white/40 hover:text-white/80 transition-colors p-2"
            aria-label="Previous"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-8 h-8">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}

        {/* Incoming image — sits behind current, revealed as current slides away */}
        {incoming && (offsetX !== 0 || transitioning) && (
          <div className="absolute inset-0 flex items-center justify-center z-0">
            {incoming.type === "video" ? (
              <video
                key={incoming.id}
                src={incoming.url}
                poster={incoming.thumbnailUrl}
                playsInline
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <img
                src={loaded.has(incoming.id) ? incoming.url : incoming.thumbnailUrl}
                alt=""
                className="max-w-full max-h-full object-contain"
                draggable={false}
              />
            )}
          </div>
        )}

        {/* Current image — slides away on swipe, revealing incoming behind it */}
        <div
          className="w-full h-full flex items-center justify-center relative z-10"
          style={{
            transform: offsetX !== 0
              ? `translateX(${offsetX}px)`
              : undefined,
            transition: swiping
              ? "none"
              : "transform 0.3s cubic-bezier(0.22, 0.68, 0, 1.0)",
          }}
        >
          {current.type === "video" ? (
            <video
              key={current.id}
              src={current.url}
              poster={current.thumbnailUrl}
              controls
              playsInline
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <>
              {!isCurrentLoaded && (
                <img
                  src={current.thumbnailUrl}
                  alt=""
                  className="max-w-full max-h-full object-contain"
                  draggable={false}
                />
              )}
              {isCurrentLoaded && (
                <img
                  ref={imageRef}
                  key={current.id}
                  src={current.url}
                  alt=""
                  className="max-w-full max-h-full object-contain"
                  draggable={false}
                />
              )}
            </>
          )}
        </div>

        {/* Next arrow — desktop only */}
        {index < count - 1 && (
          <button
            onClick={goNext}
            className="hidden sm:flex absolute right-3 z-10 text-white/40 hover:text-white/80 transition-colors p-2"
            aria-label="Next"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-8 h-8">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}
      </div>

      {/* Bottom dot indicators for multi-photo */}
      {count > 1 && (
        <div className="absolute bottom-0 left-0 right-0 z-20 flex justify-center gap-1.5 py-4">
          {media.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === index ? "bg-white" : "bg-white/30"
              }`}
              aria-label={`Go to image ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
