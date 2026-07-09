"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

// Pull-to-refresh for the standalone PWA, where there's no Safari chrome (and
// therefore no reload button). Pulling down past the threshold at the top of
// the page triggers router.refresh(), which re-fetches the server-rendered
// content — new photos, edits, deletions all appear.
//
// It deliberately does nothing on authoring surfaces (upload / edit), where an
// accidental refresh would discard in-progress work, and stays out of the way
// whenever a scroll-locking overlay (lightbox, slide-out menu) is open.

const THRESHOLD = 70; // px of pull needed to trigger a refresh
const MAX_PULL = 110; // clamp the visual travel
const RESISTANCE = 0.5; // rubber-band feel — finger moves twice as far as the pill
const SPINNER_MS = 900; // router.refresh() has no completion signal; show feedback briefly

export default function PullToRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const active = useRef(false);
  const pullDist = useRef(0);

  const disabled =
    pathname === "/login" ||
    pathname === "/admin/upload" ||
    pathname === "/admin/bulk-import" ||
    (pathname.startsWith("/admin/posts/") && pathname.endsWith("/edit"));

  useEffect(() => {
    if (disabled) return;

    // Lightbox + slide-out menu both lock the body with overflow:hidden while
    // open — treat that as "a modal owns the gestures" and stay dormant.
    const modalOpen = () => document.body.style.overflow === "hidden";

    function onTouchStart(e: TouchEvent) {
      if (refreshing || e.touches.length !== 1) return;
      if (window.scrollY > 0 || modalOpen()) return;
      startY.current = e.touches[0].clientY;
      active.current = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!active.current || startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || window.scrollY > 0) {
        pullDist.current = 0;
        setPull(0);
        return;
      }
      const dist = Math.min(dy * RESISTANCE, MAX_PULL);
      pullDist.current = dist;
      setPull(dist);
      // Suppress the native overscroll glow so our indicator reads cleanly.
      if (dist > 4 && e.cancelable) e.preventDefault();
    }

    function onTouchEnd() {
      if (!active.current) return;
      active.current = false;
      startY.current = null;
      const triggered = pullDist.current >= THRESHOLD;
      pullDist.current = 0;
      setPull(0);
      if (triggered) {
        setRefreshing(true);
        router.refresh();
        window.setTimeout(() => setRefreshing(false), SPINNER_MS);
      }
    }

    // touchmove must be non-passive so preventDefault can stop the rubber-band.
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [disabled, refreshing, router]);

  if (disabled) return null;

  const progress = Math.min(pull / THRESHOLD, 1);
  const visible = pull > 0 || refreshing;
  const travel = refreshing ? 48 : pull; // px the pill sits below the top edge

  return (
    <div
      aria-hidden
      className="fixed left-0 right-0 z-[45] flex justify-center pointer-events-none"
      style={{
        top: "env(safe-area-inset-top)",
        transform: `translateY(${travel - 44}px)`,
        opacity: visible ? 1 : 0,
        transition: active.current
          ? "none"
          : "transform 0.25s ease, opacity 0.2s ease",
      }}
    >
      <div className="w-9 h-9 rounded-full bg-[#232222] border border-[#322e29] shadow-lg shadow-black/40 flex items-center justify-center">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="#c2a467"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-[18px] h-[18px] ${refreshing ? "animate-spin" : ""}`}
          style={{
            transform: refreshing ? undefined : `rotate(${progress * 300}deg)`,
            opacity: refreshing ? 1 : 0.35 + progress * 0.65,
          }}
        >
          <path d="M23 4v6h-6" />
          <path d="M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </div>
    </div>
  );
}
