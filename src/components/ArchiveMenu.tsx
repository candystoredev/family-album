"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

export default function ArchiveMenu() {
  const [open, setOpen] = useState(false);
  const [fabVisible, setFabVisible] = useState(true);
  const [data, setData] = useState<ArchiveData | null>(null);
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const lastScrollY = useRef(0);
  const accumulatedDelta = useRef(0);
  const pathname = usePathname();

  // Hide on login page
  const isLoginPage = pathname === "/login";

  // Hide FAB on scroll down, show on scroll up (with threshold)
  useEffect(() => {
    if (isLoginPage) return;

    function handleScroll() {
      const currentY = window.scrollY;
      const delta = currentY - lastScrollY.current;

      // Reset accumulator when direction changes
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

      // Always show at top of page
      if (currentY <= 10) {
        setFabVisible(true);
      }

      lastScrollY.current = currentY;
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isLoginPage]);

  // Fetch archive data when panel opens
  const fetchData = useCallback(async () => {
    if (data) return; // already loaded
    setLoading(true);
    try {
      const res = await fetch("/api/archive");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        // Auto-expand the most recent year
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
    // Prevent body scroll when panel is open
    document.body.style.overflow = "hidden";
  }

  function handleClose() {
    setOpen(false);
    document.body.style.overflow = "";
  }

  // Close panel on navigation
  useEffect(() => {
    handleClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (isLoginPage) return null;

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={open ? handleClose : handleOpen}
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-[#252424] border border-[#333] shadow-lg shadow-black/40 flex items-center justify-center transition-all duration-300 active:scale-95 ${
          open
            ? "opacity-100 translate-y-0"
            : fabVisible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4 pointer-events-none"
        }`}
        aria-label={open ? "Close menu" : "Open menu"}
      >
        {open ? (
          /* X icon */
          <svg viewBox="0 0 24 24" fill="none" stroke="#427ea3" strokeWidth="2" strokeLinecap="round" className="w-6 h-6">
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        ) : (
          /* Hamburger icon */
          <svg viewBox="0 0 24 24" fill="none" stroke="#427ea3" strokeWidth="2" strokeLinecap="round" className="w-6 h-6">
            <path d="M4 6h16" />
            <path d="M4 12h16" />
            <path d="M4 18h16" />
          </svg>
        )}
      </button>

      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={handleClose}
      />

      {/* Slide-out Panel */}
      <nav
        className={`fixed top-0 left-0 z-40 h-full w-[80vw] max-w-[360px] bg-[#1a1a1a] shadow-2xl shadow-black/50 transform transition-transform duration-300 ease-out overflow-y-auto overscroll-contain ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-6 pt-12 pb-32">
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

                      {/* Month list */}
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
        </div>
      </nav>
    </>
  );
}
