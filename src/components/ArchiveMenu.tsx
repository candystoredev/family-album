"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTimelineStyle } from "@/lib/useTimelineStyle";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
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
  buildVersion: string;
}

// ─── Inline icons ─────────────────────────────────────────────────────────────

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 9 16" fill="none" className={className}>
      <path d="M1 1l6 7-6 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ArchiveMenu({ isAdmin, isLoggedIn, buildVersion }: ArchiveMenuProps) {
  const [open, setOpen] = useState(false);
  const [fabVisible, setFabVisible] = useState(true);
  const [data, setData] = useState<ArchiveData | null>(null);
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [railYear, setRailYear] = useState<number | null>(null);
  const [albumsExpanded, setAlbumsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);
  const [sidebarFits, setSidebarFits] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [timelineStyle] = useTimelineStyle();
  const lastScrollY = useRef(0);
  const accumulatedDelta = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  // Hide on login, upload, and share pages (share page visible to admins only)
  const isLoginPage = pathname === "/login";
  const isUploadPage = pathname === "/admin/upload";
  const isBulkImportPage = pathname === "/admin/bulk-import";
  const isSharePage = pathname.startsWith("/share/") && !isAdmin;
  // Admin authoring tools own the full screen — the slide-out would overlap them
  const isHiddenPage = isLoginPage || isUploadPage || isBulkImportPage || isSharePage;

  // Track desktop vs mobile
  useEffect(() => {
    if (isHiddenPage) return;

    function check() {
      setIsDesktop(window.innerWidth >= LG_BREAKPOINT);
      setSidebarFits(window.innerWidth >= SIDEBAR_FITS_BREAKPOINT);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [isLoginPage]);

  // Pre-fetch archive data on mount (eliminates spinner on first open)
  useEffect(() => {
    if (!isHiddenPage) fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide FAB on scroll down, show on scroll up (mobile only)
  useEffect(() => {
    if (isHiddenPage || isDesktop) return;

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
          setRailYear(json.years[0].year);
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
    if (!isDesktop) handleClose();
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

  if (isHiddenPage) return null;

  const railMonths =
    (railYear != null && data?.years.find((y) => y.year === railYear)?.months) || [];

  // ─── Shared sidebar content ───
  const sidebarContent = (
    // Grain lives on this full-content-height wrapper (not the scrolling <nav>,
    // whose ::before would only span one viewport and leave a seam on scroll).
    // Inner relative div paints content above the grain.
    <div className="paper-grain relative min-h-full">
    <div className="relative px-[22px] pt-14 pb-32 flex flex-col min-h-full">
      {/* Brand header — gold serif monogram + wordmark (replaces build string) */}
      <div className="flex items-center gap-[14px] mb-[26px]">
        <span
          className="flex-none w-12 h-12 rounded-xl flex items-center justify-center font-serif font-semibold text-[28px] leading-none text-[#c2a467] bg-[#151312]"
          style={{
            border: "1px solid rgba(194,164,103,0.42)",
            boxShadow:
              "inset 0 0 0 1px rgba(194,164,103,0.08), inset 0 1px 0 rgba(255,255,255,0.05)",
          }}
        >
          H
        </span>
        <div className="flex-1">
          <div className="font-serif text-[23px] font-semibold tracking-[-0.01em] text-[#efeae1]">
            The Hoecks
          </div>
          <div className="text-[10.5px] font-bold tracking-[0.22em] uppercase text-[#8a774d] mt-1">
            Family Archive
          </div>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-[30px]">
        <div className="relative">
          <SearchIcon className="absolute left-[15px] top-1/2 -translate-y-1/2 w-[17px] h-[17px] text-[#857f73] pointer-events-none" />
          <input
            ref={isDesktop ? undefined : searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search the album…"
            className="gold-focus w-full h-[50px] bg-[#151312] text-[#ece8e1] text-base rounded-[13px] pl-11 pr-4 border border-[#322e29] transition-shadow placeholder:text-[#6c675d]"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
      </form>

      {/* The Latest — masthead */}
      <a
        href="/"
        onClick={(e) => {
          if (pathname === "/") {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        }}
        className="flex items-center gap-[14px] px-[15px] py-[17px] rounded-[14px] bg-[#201d19] mb-[10px] transition-colors"
        style={{
          border: "1px solid rgba(194,164,103,0.26)",
          boxShadow: "0 10px 26px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <span
          className="flex-none w-11 h-11 rounded-[11px] flex items-center justify-center"
          style={{
            background: "rgba(194,164,103,0.12)",
            border: "1px solid rgba(194,164,103,0.30)",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 3l1.7 5.1 5.3.2-4.2 3.3 1.5 5.1L12 14.9 7.7 17l1.5-5.1L5 8.6l5.3-.2L12 3z" fill="#c2a467" />
          </svg>
        </span>
        <span className="flex-1">
          <span className="block font-serif text-[22px] font-semibold text-[#f1ece3]">
            The Latest
          </span>
          <span className="block text-[11px] font-bold tracking-[0.14em] uppercase text-[#9a8758] mt-[3px]">
            Newest moments first
          </span>
        </span>
        <ChevronRight className="w-[9px] h-4 text-[#a9925f]" />
      </a>

      {/* Favorites */}
      <Link
        href="/favorites"
        className="flex items-center gap-[14px] px-[15px] py-[14px] rounded-[13px] bg-[#1c1a18] border border-[#2b2722] min-h-[56px] mb-2.5 transition-colors hover:bg-[#211e1b]"
      >
        <span
          className="flex-none w-11 h-11 rounded-[11px] flex items-center justify-center"
          style={{
            background: "rgba(217,101,95,0.10)",
            border: "1px solid rgba(217,101,95,0.22)",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" fill="#d9655f" />
          </svg>
        </span>
        <span className="flex-1 text-[17px] font-semibold text-[#e5e0d6]">Favorites</span>
        <ChevronRight className="w-[9px] h-4 text-[#524e45]" />
      </Link>

      {/* On This Day — the daily memory page (also reachable via push notification) */}
      <Link
        href="/today"
        className="flex items-center gap-[14px] px-[15px] py-[14px] rounded-[13px] bg-[#1c1a18] border border-[#2b2722] min-h-[56px] mb-[30px] transition-colors hover:bg-[#211e1b]"
      >
        <span
          className="flex-none w-11 h-11 rounded-[11px] flex items-center justify-center"
          style={{
            background: "rgba(194,164,103,0.12)",
            border: "1px solid rgba(194,164,103,0.30)",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="13" r="7" stroke="#cda86a" strokeWidth="1.8" />
            <path d="M12 10v3l2 1.5" stroke="#cda86a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 4l2.5 2M19 4l-2.5 2" stroke="#cda86a" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <span className="flex-1 text-[17px] font-semibold text-[#e5e0d6]">On This Day</span>
        <ChevronRight className="w-[9px] h-4 text-[#524e45]" />
      </Link>

      {loading && !data && (
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 border-[#322e29] border-t-[#c2a467] rounded-full animate-spin" />
        </div>
      )}

      {data && (
        <>
          {/* ALBUMS — compact rows; "All albums" expands the full list in place,
              fading/covering the timeline below so the timeline stays the default focus. */}
          {data.albums.length > 0 && (
            <section className="mb-6">
              <h3 className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#8a774d] mb-2">
                Albums
              </h3>
              <div className="space-y-0.5">
                {(albumsExpanded ? data.albums : data.albums.slice(0, 4)).map((album) => (
                  <Link
                    key={album.slug}
                    href={`/albums/${album.slug}`}
                    className="flex items-center gap-3 px-2 min-h-[40px] rounded-lg transition-colors hover:bg-[#211e1b]"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="flex-none">
                      <rect x="3" y="6" width="13" height="12" rx="2" stroke="#8a8378" strokeWidth="1.6" />
                      <path d="M7 6V5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2h-1" stroke="#8a8378" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                    <span className="flex-1 text-[15px] text-[#c9c4ba] truncate">{album.title}</span>
                  </Link>
                ))}
              </div>
              {data.albums.length > 4 && (
                <button
                  onClick={() => setAlbumsExpanded((v) => !v)}
                  className="flex items-center gap-3 px-2 min-h-[40px] w-full rounded-lg text-left transition-colors hover:bg-[#211e1b]"
                  aria-expanded={albumsExpanded}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    className={`flex-none text-[#8a774d] transition-transform duration-300 ${albumsExpanded ? "rotate-180" : ""}`}
                  >
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-[14px] font-semibold tracking-wide text-[#8a774d]">
                    {albumsExpanded ? "Show fewer" : `All albums (${data.albums.length})`}
                  </span>
                </button>
              )}
            </section>
          )}

          {/* TIMELINE — fades out and collapses when the album list is expanded
              over it, so albums can occupy the space without a page change. */}
          <div
            className={`transition-all duration-300 ease-out ${
              albumsExpanded
                ? "opacity-0 max-h-0 overflow-hidden pointer-events-none"
                : "opacity-100 max-h-[6000px]"
            }`}
            aria-hidden={albumsExpanded}
          >
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#8a774d]">
              Timeline
            </span>
            <span className="flex-1 h-0 border-b border-[#2b2722]" />
          </div>

          {/* Classic list (default) — desktop always uses classic */}
          {(timelineStyle === "classic" || isDesktop) && (
            <div>
              {data.years.map(({ year, months }) => {
                const isExpanded = expandedYear === year;
                return (
                  <div key={year} className="border-b border-[#232020]">
                    <button
                      onClick={() => setExpandedYear(isExpanded ? null : year)}
                      className="w-full flex items-center gap-[14px] py-[14px] px-[2px] min-h-[58px] transition-opacity hover:opacity-90"
                    >
                      <span className="font-serif text-[27px] font-medium text-[#d8d3c8] tracking-[0.01em] tabular-nums min-w-[76px] text-left">
                        {year}
                      </span>
                      <span className="flex-1 h-0 border-b border-[#2b2722]" />
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        className={`w-[13px] h-[13px] text-[#8a774d] transition-transform duration-200 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      >
                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>

                    <div
                      className={`overflow-hidden transition-all duration-300 ease-out ${
                        isExpanded ? "max-h-[640px] opacity-100" : "max-h-0 opacity-0"
                      }`}
                    >
                      <div className="ml-2 mb-3 pt-0.5">
                        {months.map((m) => (
                          <Link
                            key={m.month}
                            href={`/archive/${year}/${m.month}`}
                            className="flex items-center gap-3 py-2 pl-[18px] pr-3 rounded-lg min-h-[40px] transition-colors hover:bg-[#211e1b]"
                          >
                            <span className="text-[15px] font-medium text-[#c2bdb3]">
                              {MONTH_NAMES[m.month]}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Year rail — any year one tap away (mobile only) */}
          {timelineStyle === "rail" && !isDesktop && (
            <div className="flex gap-4 mt-1.5">
              <div className="flex-1 min-w-0">
                <div className="font-serif text-[30px] font-semibold text-[#cfae6f] mt-0.5 mb-2 tabular-nums">
                  {railYear}
                </div>
                {railMonths.map((m) => (
                  <Link
                    key={m.month}
                    href={`/archive/${railYear}/${m.month}`}
                    className="flex items-center px-3 py-[9px] rounded-[9px] min-h-[42px] transition-colors hover:bg-[#211e1b]"
                  >
                    <span className="text-base font-medium text-[#c2bdb3]">
                      {MONTH_NAMES[m.month]}
                    </span>
                  </Link>
                ))}
              </div>
              <div className="flex-none w-[54px] flex flex-col gap-0.5 border-l border-[#262320] pl-2 opacity-70">
                {data.years.map(({ year }) => {
                  const selected = year === railYear;
                  return (
                    <button
                      key={year}
                      onClick={() => setRailYear(year)}
                      className={`rounded-[7px] py-1.5 px-0.5 text-xs font-semibold tabular-nums text-center min-h-[30px] transition-colors ${
                        selected
                          ? "bg-[#c2a467] text-[#1a1715]"
                          : "text-[#7d7468] hover:bg-[#211e1b]"
                      }`}
                    >
                      {year}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          </div>
        </>
      )}

      {/* Spacer to push admin footer to bottom */}
      <div className="flex-1" />

      {/* Admin footer + build string */}
      {isLoggedIn && (
        <div className="mt-7 pt-[22px] border-t border-[#2b2722]">
          {isAdmin && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z" stroke="#8a774d" strokeWidth="2" strokeLinejoin="round" />
                </svg>
                <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#8a774d]">
                  Admin
                </span>
              </div>
              <a
                href="/admin/upload"
                className="flex items-center gap-[13px] px-[6px] py-[11px] min-h-[44px] rounded-[9px] transition-colors hover:bg-[#211e1b]"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M12 16V4m0 0L7 9m5-5l5 5" stroke="#c2a467" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" stroke="#c2a467" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span className="text-base font-semibold text-[#cfae6f]">Upload Photo</span>
              </a>
              <a
                href="/admin/bulk-import"
                className="hidden md:flex items-center gap-[13px] px-[6px] py-[11px] min-h-[44px] rounded-[9px] transition-colors hover:bg-[#211e1b]"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="4" width="18" height="5" rx="1.5" stroke="#a39d92" strokeWidth="1.8" />
                  <rect x="3" y="11" width="18" height="9" rx="1.5" stroke="#a39d92" strokeWidth="1.8" />
                </svg>
                <span className="text-base font-medium text-[#c9c4ba]">Bulk Import</span>
              </a>
            </>
          )}
          <Link
            href="/settings"
            className="flex items-center gap-[13px] px-[6px] py-[11px] min-h-[44px] rounded-[9px] transition-colors hover:bg-[#211e1b]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a39d92" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-base font-medium text-[#c9c4ba]">Settings</span>
          </Link>
          <div className="h-px bg-[#232020] mx-[6px] my-2.5" />
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-[13px] px-[6px] py-[11px] min-h-[44px] rounded-[9px] transition-colors hover:bg-[rgba(217,101,95,0.06)]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="#938b82" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M16 17l5-5-5-5M21 12H9" stroke="#938b82" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-base font-medium text-[#938b82]">Log out</span>
          </button>
          <div className="font-mono text-[10.5px] tracking-[0.14em] text-[#4f4b43] px-[6px] pt-[14px] uppercase">
            Build {buildVersion}
          </div>
        </div>
      )}
    </div>
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
        className="fixed top-0 left-0 z-30 h-full w-[280px] bg-[#1a1918] overflow-y-auto overscroll-contain transition-all duration-300"
        style={{
          opacity: tucked ? (showFull ? 1 : 0) : showFull ? 1 : 0.35,
          transform: tucked && !showFull ? "translateX(-256px)" : "translateX(0)",
        }}
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
      >
        {sidebarContent}
      </nav>
    );
  }

  // ─── Mobile: FAB cluster + slide-out overlay ───
  return (
    <>
      {/* Secondary FAB — Upload (admin only), arcs straight up from the primary */}
      {isAdmin && (
        <Link
          href="/admin/upload"
          onClick={handleClose}
          className="fixed bottom-6 right-6 z-[49] w-[46px] h-[46px] rounded-full bg-[#211e1b] border border-[#322e29] shadow-lg shadow-black/45 flex items-center justify-center lg:hidden"
          style={{
            transform: open ? "translate(0, -76px) scale(1)" : "translate(0,0) scale(0)",
            opacity: open ? 1 : 0,
            pointerEvents: open ? "auto" : "none",
            transition: open
              ? "transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.15s ease-out"
              : "transform 0.2s ease-in, opacity 0.15s ease-in",
          }}
          aria-label="New upload"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="#c2a467" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
            <path d="M12 16V4m0 0L7 9m5-5l5 5" strokeLinejoin="round" />
            <path d="M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" />
          </svg>
        </Link>
      )}

      {/* Secondary FAB — Timeline/Albums toggle, arcs to the upper-left (between
          Upload and Settings). Drives the same albumsExpanded state as the inline
          "All albums" control; stays open (no navigation). Icon shows what you'll
          switch TO: albums-stack when the timeline is showing, calendar when albums are. */}
      {data && data.albums.length > 0 && (
        <button
          onClick={() => setAlbumsExpanded((v) => !v)}
          className="fixed bottom-6 right-6 z-[49] w-[46px] h-[46px] rounded-full bg-[#211e1b] border border-[#322e29] shadow-lg shadow-black/45 flex items-center justify-center lg:hidden"
          style={{
            transform: open ? "translate(-54px, -54px) scale(1)" : "translate(0,0) scale(0)",
            opacity: open ? 1 : 0,
            pointerEvents: open ? "auto" : "none",
            transition: open
              ? "transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.15s ease-out"
              : "transform 0.2s ease-in, opacity 0.15s ease-in",
          }}
          aria-label={albumsExpanded ? "Show timeline" : "Show albums"}
          aria-pressed={albumsExpanded}
        >
          {albumsExpanded ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="#c2a467" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <rect x="3" y="4.5" width="18" height="16" rx="2" />
              <path d="M3 9.5h18" />
              <path d="M8 3v3M16 3v3" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="#c2a467" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <rect x="3" y="6" width="13" height="13" rx="2" />
              <path d="M8 6V5a2 2 0 012-2h9a2 2 0 012 2v9a2 2 0 01-2 2h-1" />
            </svg>
          )}
        </button>
      )}

      {/* Secondary FAB — Settings, arcs to the left (9 o'clock) of the primary */}
      {isLoggedIn && (
        <Link
          href="/settings"
          onClick={handleClose}
          className="fixed bottom-6 right-6 z-[49] w-[46px] h-[46px] rounded-full bg-[#211e1b] border border-[#322e29] shadow-lg shadow-black/45 flex items-center justify-center lg:hidden"
          style={{
            transform: open ? "translate(-76px, 0px) scale(1)" : "translate(0,0) scale(0)",
            opacity: open ? 1 : 0,
            pointerEvents: open ? "auto" : "none",
            transition: open
              ? "transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.15s ease-out"
              : "transform 0.2s ease-in, opacity 0.15s ease-in",
          }}
          aria-label="Settings"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="#c2a467" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </Link>
      )}

      {/* Primary Floating Action Button — gold */}
      <button
        onClick={open ? handleClose : handleOpen}
        className={`fixed bottom-6 right-6 z-50 w-[60px] h-[60px] rounded-full bg-[#c2a467] flex items-center justify-center transition-all duration-300 active:scale-95 lg:hidden ${
          open
            ? "opacity-100 translate-y-0"
            : fabVisible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4 pointer-events-none"
        }`}
        style={{
          border: "1px solid rgba(255,255,255,0.16)",
          boxShadow:
            "0 10px 28px rgba(122,96,42,0.5), inset 0 1px 0 rgba(255,255,255,0.35)",
        }}
        aria-label={open ? "Close menu" : "Open menu"}
      >
        {open ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="#1a1715" strokeWidth="2.6" strokeLinecap="round" className="w-6 h-6">
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="#1a1715" strokeWidth="2.4" strokeLinecap="round" className="w-6 h-6">
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
        className={`fixed top-0 left-0 z-40 h-full w-[85vw] max-w-[380px] bg-[#1a1918] shadow-2xl shadow-black/50 transform transition-transform duration-300 ease-out overflow-y-auto overscroll-contain lg:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarContent}
      </nav>
    </>
  );
}
