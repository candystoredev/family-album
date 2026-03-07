"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface DoubleTapHeartProps {
  mediaId: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const HEARTS_KEY = "thehoecks_hearts";

export function getHearts(): Set<string> {
  try {
    const raw = localStorage.getItem(HEARTS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function saveHearts(hearts: Set<string>) {
  localStorage.setItem(HEARTS_KEY, JSON.stringify([...hearts]));
}

export default function DoubleTapHeart({
  mediaId,
  children,
  className = "",
  onClick,
}: DoubleTapHeartProps) {
  const [hearted, setHearted] = useState(false);
  const [showBurst, setShowBurst] = useState(false);
  const lastTap = useRef(0);
  const burstTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setHearted(getHearts().has(mediaId));
  }, [mediaId]);

  const toggleHeart = useCallback(() => {
    const hearts = getHearts();
    if (hearts.has(mediaId)) {
      hearts.delete(mediaId);
      saveHearts(hearts);
      setHearted(false);
    } else {
      hearts.add(mediaId);
      saveHearts(hearts);
      setHearted(true);
      setShowBurst(true);
      if (burstTimeout.current) clearTimeout(burstTimeout.current);
      burstTimeout.current = setTimeout(() => setShowBurst(false), 900);
    }
  }, [mediaId]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const now = Date.now();
      if (now - lastTap.current < 350) {
        e.stopPropagation();
        toggleHeart();
        lastTap.current = 0;
      } else {
        lastTap.current = now;
        // Delay single click to differentiate from double
        setTimeout(() => {
          if (lastTap.current !== 0) {
            onClick?.();
            lastTap.current = 0;
          }
        }, 350);
      }
    },
    [toggleHeart, onClick]
  );

  return (
    <div className={`relative select-none ${className}`} onClick={handleClick}>
      {children}

      {/* Small persistent heart indicator */}
      {hearted && !showBurst && (
        <div className="absolute bottom-2 right-2 text-red-500/60 pointer-events-none">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 drop-shadow-md">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </div>
      )}

      {/* Burst animation */}
      {showBurst && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-16 h-16 text-red-500 animate-heart-burst drop-shadow-lg"
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </div>
      )}
    </div>
  );
}
