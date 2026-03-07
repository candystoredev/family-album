"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const MONTH_ABBREVS = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface ArchiveYear {
  year: number;
  months: { month: number; count: number }[];
}

interface Album {
  slug: string;
  title: string;
}

interface ArchiveData {
  years: ArchiveYear[];
  albums: Album[];
}

/** Scroll-direction threshold in pixels before toggling FAB visibility */
const SCROLL_THRESHOLD = 30;

/** Desktop breakpoint — matches Tailwind's lg */
const LG_BREAKPOINT = 1024;

/** At this width, the 280px sidebar fits beside the 900px feed without overlap */
const SIDEBAR_FITS_BREAKPOINT = 1460;

interface ArchiveMenuProps {
  isAdmin: boolean;
  isLoggedIn: boolean;
}

export default function ArchiveMenu({ isAdmin, isLoggedIn }: ArchiveMenuProps) {
  const [open, setOpen] = useState(false);
  const [fabVisible, setFabVisible] = useState(true);
  const [data, setData] = useState<ArchiveData | null>(null);
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);
  const [sidebarFits, setSidebarFits] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const lastScrollY = useRef(0);
  const accumulatedDelta = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  // Hide on login page
  const isLoginPage = pathname === "/login";

  // Track desktop vs mobile
  useEffect(() => {
    if (isLoginPage) return;

    function check() {
      setIsDesktop(window.innerWidth >= LG_BREAKPOINT);
      setSidebarFits(window.innerWidth >= SIDEBAR_FITS_BREAKPOINT);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [isLoginPage]);

  // Auto-fetch archive data on desktop (sidebar always visible)
  useEffect(() => {
    if (isDesktop && !data && !loading && !isLoginPage) {
      fetchData();
    }
  }, [isDesktop, isLoginPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide FAB on scroll down, show on scroll up (mobile only)
  useEffect(() => {
    if (isLoginPage || isDesktop) return;

    function handleScroll() {
      const currentY = window.scrollY;
      const delta = currentY - lastScrollY.current;

      if (
        (delta > 0 && accumulatedDelta.current < 0) ||
        (delta < 0 && accumulatedDelta.current > 0)
      ) {
        accumulatedDelta.current = 0;
      }

      accumulatedDelta.current += delta;

      if (accumulatedDelta.current > SCROLL_THRESHOLD) {
        setFabVisible(false);
        accumulatedDelta.current = 0;
      } else if (accumulatedDelta.current < -SCROLL_THRESHOLD) {
        setFabVisible(true);
        accumulatedDelta.current = 0;
      }

      if (currentY <= 10) {
        setFabVisible(true);
      }

      lastScrollY.current = currentY;
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isLoginPage, isDesktop]);

  const fetchData = useCallback(async () => {
    if (data) return;
    setLoading(true);
    try {
      const res = await fetch("/api/archive");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (json.years.length > 0) {
          setExpandedYear(json.years[0].year);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [data]);

  function handleOpen() {
    setOpen(true);
    fetchData();
    document.body.style.overflow = "hidden";
    setTimeout(() => searchInputRef.current?.focus(), 350);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    setSearchQuery("");
  }

  function handleClose() {
    setOpen(false);
    document.body.style.overflow = "";
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  // Close panel on navigation (mobile only)
  useEffect(() => {
    if (!isDesktop) {
      handleClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Close on Escape key (mobile overlay)
  useEffect(() => {
    if (!open || isDesktop) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isDesktop]);

  if (isLoginPage) return null;

  // Shared sidebar content
  const sidebarContent = (
    <div className="px-6 pt-8 pb-32 flex flex-col min-h-full">
      {/* Search */}
      <form onSubmit={handleSearch} className="mb-8">
        <div className="relative">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555]"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={isDesktop ? undefined : searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full bg-[#252424] text-[#d3d3d3] text-sm rounded-lg pl-10 pr-4 py-2.5 border border-[#333] focus:border-[#427ea3] focus:outline-none transition-colors placeholder:text-[#555]"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
      </form>

      {/* The Latest */}
      <Link
        href="/"
        className="block text-[#d3d3d3] text-2xl font-semibold tracking-wide hover:text-white transition-colors mb-10"
      >
        The Latest
      </Link>

      {loading && !data && (
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 border-[#333] border-t-[#427ea3] rounded-full animate-spin" />
        </div>
      )}

      {data && (
        <>
          {/* Featured (Albums) */}
          {data.albums.length > 0 && (
            <section className="mb-10">
              <h3 className="text-[#666] text-sm uppercase tracking-widest mb-4">
                Featured
              </h3>
              <div className="space-y-3 pl-2">
                {data.albums.map((album) => (
                  <Link
                    key={album.slug}
                    href={`/albums/${album.slug}`}
                    className="block text-[#d3d3d3] text-lg font-medium hover:text-white transition-colors"
                  >
                    {album.title}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Timeline */}
          <div className="space-y-1">
            {data.years.map(({ year, months }) => {
              const isExpanded = expandedYear === year;
              return (
                <div key={year}>
                  <button
                    onClick={() =>
                      setExpandedYear(isExpanded ? null : year)
                    }
                    className="w-full flex items-center justify-between py-2 text-[#d3d3d3] text-xl font-light tracking-wide hover:text-white transition-colors"
                  >
                    <span>{year}</span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      className={`w-4 h-4 text-[#555] transition-transform duration-200 ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>

                  <div
                    className={`overflow-hidden transition-all duration-200 ease-out ${
                      isExpanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
                    }`}
                  >
                    <div className="pl-3 pb-3 space-y-1">
                      {months.map((m) => (
                        <Link
                          key={m.month}
                          href={`/archive/${year}/${m.month}`}
                          className="flex items-center justify-between py-1.5 group"
                        >
                          <span className="text-[#a0a0a0] text-base font-medium group-hover:text-white transition-colors">
                            {MONTH_ABBREVS[m.month]}
                            <span className="font-light text-[#555] ml-1.5">
                              {year}
                            </span>
                          </span>
                          <span className="text-[#444] text-xs tabular-nums">
                            {m.count}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Spacer to push logout to bottom */}
      <div className="flex-1" />

      {/* Bottom: Admin badge + Logout */}
      {isLoggedIn && (
        <div className="pt-8 mt-8 border-t border-[#2a2929] space-y-3">
          {isAdmin && (
            <span className="inline-block text-[10px] text-[#427ea3] border border-[#427ea3]/40 px-2 py-0.5 rounded uppercase tracking-wider">
              Admin
            </span>
          )}
          <button
            onClick={handleLogout}
            className="block text-sm text-[#666] hover:text-[#d3d3d3] transition-colors"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );

  // ─── Desktop: persistent left sidebar ───
  if (isDesktop) {
    // When sidebar fits beside feed: always visible, fade on hover
    // When it doesn't fit: tucked with 24px hint, slides in on hover
    const tucked = !sidebarFits;
    const showFull = sidebarHovered;

    return (
      <nav
        className="fixed top-0 left-0 z-30 h-full w-[280px] bg-[#1d1c1c] overflow-y-auto overscroll-contain transition-all duration-300"
        style={{
          opacity: tucked
            ? (showFull ? 1 : 0)
            : (showFull ? 1 : 0.35),
          transform: tucked && !showFull ? "translateX(-256px)" : "translateX(0)",
        }}
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
      >
        {sidebarContent}
      </nav>
    );
  }

  // ─── Mobile: FAB + slide-out overlay ───
  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={open ? handleClose : handleOpen}
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-[#252424] border border-[#333] shadow-lg shadow-black/40 flex items-center justify-center transition-all duration-300 active:scale-95 lg:hidden ${
          open
            ? "opacity-100 translate-y-0"
            : fabVisible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4 pointer-events-none"
        }`}
        aria-label={open ? "Close menu" : "Open menu"}
      >
        {open ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="#427ea3" strokeWidth="2" strokeLinecap="round" className="w-6 h-6">
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="#427ea3" strokeWidth="2" strokeLinecap="round" className="w-6 h-6">
            <path d="M4 6h16" />
            <path d="M4 12h16" />
            <path d="M4 18h16" />
          </svg>
        )}
      </button>

      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={handleClose}
      />

      {/* Slide-out Panel */}
      <nav
        className={`fixed top-0 left-0 z-40 h-full w-[80vw] max-w-[360px] bg-[#1a1a1a] shadow-2xl shadow-black/50 transform transition-transform duration-300 ease-out overflow-y-auto overscroll-contain lg:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarContent}
      </nav>
    </>
  );
}
