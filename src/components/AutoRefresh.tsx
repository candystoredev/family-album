"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// iOS keeps home-screen web apps suspended in memory and resumes them without
// reloading — sometimes days later. With no Safari chrome there's no manual
// refresh, so on re-foreground we self-heal: full reload if a new build was
// deployed (the old bundle's hashed chunks no longer exist on the server),
// otherwise a silent router.refresh() so new photos appear.
const STALE_AFTER_MS = 5 * 60 * 1000;

export default function AutoRefresh({ buildVersion }: { buildVersion: string }) {
  const router = useRouter();
  const hiddenAt = useRef<number | null>(null);
  const checking = useRef(false);

  useEffect(() => {
    async function revalidate() {
      if (checking.current) return;
      checking.current = true;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (res.ok) {
          const { version } = await res.json();
          if (version !== buildVersion) {
            window.location.reload();
            return;
          }
        }
      } catch {
        // Offline — leave the page alone.
      } finally {
        checking.current = false;
      }
      router.refresh();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      const awayMs = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      if (awayMs > STALE_AFTER_MS) void revalidate();
    }

    // Fires on bfcache restore (event.persisted) — treat like a long absence.
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) void revalidate();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [buildVersion, router]);

  return null;
}
