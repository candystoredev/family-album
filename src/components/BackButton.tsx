"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

// A back affordance for the standalone PWA, which has no Safari back button.
// Shows a small chevron in the top-left on nested browse pages (favorites,
// archive, albums, tags, people, a single post, settings, search). Hidden on:
//   - the main feed ("/"), which is the natural root — nowhere to go back to;
//   - login;
//   - /admin/* authoring pages, which own the full screen and carry their own
//     Cancel / back controls;
//   - public /share and /m landing pages, which are often the entry point.
// On hover-capable desktop the persistent sidebar occupies the left edge and
// the browser has its own back button, so the chevron hides there too.

export default function BackButton() {
  const pathname = usePathname();
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    // Only offer back when there's in-app history to pop; otherwise it would
    // walk the user out of the app.
    setCanGoBack(window.history.length > 1);
  }, [pathname]);

  const hidden =
    pathname === "/" ||
    pathname === "/login" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/m/");

  if (hidden || !canGoBack) return null;

  return (
    <button
      onClick={() => router.back()}
      aria-label="Go back"
      className="fixed left-3 z-30 w-10 h-10 rounded-full bg-[#211e1b]/85 backdrop-blur border border-[#322e29] shadow-lg shadow-black/40 flex items-center justify-center active:scale-95 transition-transform [@media(hover:hover)]:lg:hidden"
      style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="#c2a467"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-5 h-5"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}
