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

export default function Lightbox({
  media,
  initialIndex,
  onClose,
}: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchDeltaX = useRef(0);
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const count = media.length;
  const current = media[index];

  const goNext = useCallback(() => {
    if (index < count - 1) setIndex((i) => i + 1);
  }, [index, count]);

  const goPrev = useCallback(() => {
    if (index > 0) setIndex((i) => i - 1);
  }, [index]);

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
    setSwiping(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    touchDeltaX.current = dx;

    // Only track horizontal swipe if it's more horizontal than vertical
    if (Math.abs(dx) > Math.abs(dy)) {
      setOffsetX(dx);
    }
  }

  function onTouchEnd() {
    setSwiping(false);
    const threshold = 60;
    if (touchDeltaX.current < -threshold) {
      goNext();
    } else if (touchDeltaX.current > threshold) {
      goPrev();
    }
    setOffsetX(0);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
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

      {/* Image area */}
      <div className="flex-1 flex items-center justify-center min-h-0 relative overflow-hidden">
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

        <div
          className="w-full h-full flex items-center justify-center px-2 sm:px-16"
          style={{
            transform: swiping ? `translateX(${offsetX}px)` : undefined,
            transition: swiping ? "none" : "transform 0.2s ease-out",
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
            <img
              key={current.id}
              src={current.url}
              alt=""
              className="max-w-full max-h-full object-contain"
              draggable={false}
            />
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
        <div className="flex justify-center gap-1.5 py-4 shrink-0">
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
