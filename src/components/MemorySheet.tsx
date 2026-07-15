"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CURVE = "cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * Full-screen "curtain" sheet for the intercepted /today route. Slides DOWN over
 * the feed on open and back UP on close, then pops the history entry so the feed
 * (still mounted underneath) is revealed. Transform-only animation.
 *
 * The panel keeps a transform, which makes it the containing block for any fixed
 * descendant — fine here because the panel is full-viewport, so the Lightbox
 * opened from TodayMemory (position: fixed, inline-rendered) still covers the
 * screen and paints above the sheet's own content.
 */
export default function MemorySheet({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const reduced = useRef(false);
  const closeGuard = useRef(false); // one-shot: block re-entrant close
  const backGuard = useRef(false); // one-shot: never call router.back() twice
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Slide in on mount. The rAF lets the initial translateY(-100%) paint before
  // flipping to translateY(0), so the transition actually runs.
  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Move focus to the close button so keyboard/AT users land inside the dialog.
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  // Body scroll lock; restore whatever was there before (the sheet has its own
  // scroller). PullToRefresh treats body overflow:hidden as "a modal owns the
  // gestures" and stays dormant while the sheet is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const finishClose = useCallback(() => {
    if (backGuard.current) return;
    backGuard.current = true;
    if (fallbackTimer.current) {
      clearTimeout(fallbackTimer.current);
      fallbackTimer.current = null;
    }
    router.back();
  }, [router]);

  const close = useCallback(() => {
    if (closeGuard.current) return;
    closeGuard.current = true;
    setClosing(true);
    if (reduced.current) {
      finishClose();
      return;
    }
    // Drive the close off transitionend, with a timeout in case it never fires.
    fallbackTimer.current = setTimeout(finishClose, 400);
  }, [finishClose]);

  // If the sheet unmounts mid-close (browser back / iOS edge-swipe pops the
  // history entry before the exit transition finishes), the armed fallback
  // timer would fire router.back() a second time and navigate one entry too
  // far. Disarm it on unmount — only the timer; latching backGuard here would
  // brick close() in dev, where Strict Mode runs this cleanup once at mount.
  useEffect(() => {
    return () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    };
  }, []);

  // Escape closes, matching the Lightbox / menu affordances.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // A lightbox stacked inside the sheet owns the Escape — it should close
      // the photo without also sliding the whole sheet away. Both listen on
      // window and the sheet's handler is registered first, so bail here when a
      // lightbox is present and let its own handler take the keypress.
      if (document.querySelector("[data-lightbox]")) return;
      close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  function onPanelTransitionEnd(e: React.TransitionEvent) {
    // Only the panel's own transform completing — not a child's transition
    // bubbling up — should trigger the history pop.
    if (!closing) return;
    if (e.target !== panelRef.current || e.propertyName !== "transform") return;
    finishClose();
  }

  const open = entered && !closing;
  const dur = closing ? 300 : 380;
  const transformTransition = reduced.current ? "none" : `transform ${dur}ms ${CURVE}`;
  const opacityTransition = reduced.current ? "none" : `opacity ${dur}ms ${CURVE}`;

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop — the panel covers the screen, so this only shows in the gap
          during the slide; pointer-events-none, no close-on-tap needed. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-black pointer-events-none"
        style={{ opacity: open ? 0.45 : 0, transition: opacityTransition }}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="absolute inset-0 bg-[#1a1918]"
        style={{
          transform: open ? "translateY(0)" : "translateY(-100%)",
          transition: transformTransition,
        }}
        onTransitionEnd={onPanelTransitionEnd}
      >
        <button
          ref={closeBtnRef}
          onClick={close}
          aria-label="Close"
          className="absolute right-4 z-20 w-10 h-10 rounded-full bg-[#211e1a]/90 border border-[#2b2722] text-[#a39e93] hover:text-[#efeae1] backdrop-blur-sm flex items-center justify-center transition-colors"
          style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            className="w-5 h-5"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="h-full overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
