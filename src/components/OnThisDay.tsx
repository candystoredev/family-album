"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface OnThisDayPost {
  slug: string;
  thumbnailUrl: string | null;
}

// Fanned "printed photo" transforms for the first three thumbnails. The middle
// one sits on top (highest zIndex) so the stack reads front-to-back.
const FAN_ROTATE = ["-8deg", "3deg", "9deg"];
const FAN_Z = [1, 3, 2];

/**
 * Home-feed teaser for "On This Day" — a compact chrome-less row that links
 * to /today. The link is intercepted into a slide-down sheet over the feed (see
 * app/@modal/(.)today); the full viewer lives on the /today page, not here.
 */
export default function OnThisDay() {
  const [posts, setPosts] = useState<OnThisDayPost[]>([]);
  const [month, setMonth] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);

  useEffect(() => {
    // No month/day params — the API resolves "today" in the album's configured
    // timezone (same source as the /today page), so the teaser and page agree.
    fetch("/api/on-this-day")
      .then((r) => (r.ok ? r.json() : { posts: [] }))
      .then((data) => {
        setPosts(data.posts || []);
        if (data.month) setMonth(data.month);
        if (data.day) setDay(data.day);
      })
      .catch(() => {});
  }, []);

  if (posts.length === 0) return null;

  const count = posts.length;
  const memoriesLabel = count === 1 ? "1 memory" : `${count} memories`;
  // Day label from the API's month/day (not client `new Date()`), formatted like
  // the page so the two never disagree across a timezone boundary.
  const dayLabel =
    month && day
      ? new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        })
      : "";

  return (
    <div className="mb-7 px-4 sm:px-0">
      {/* scroll={false}: the intercepted sheet covers the viewport, and Next's
          default scroll-on-navigate jumps the feed to the @modal slot at the
          document bottom — visible behind the panel while it slides down. */}
      <Link
        href="/today"
        scroll={false}
        className="group flex w-full items-center gap-3.5 py-1.5 transition-opacity active:opacity-60"
      >
        {/* Fanned stack of the first three thumbnails — little printed photos */}
        <div className="flex shrink-0 -space-x-2.5 py-0.5">
          {posts.slice(0, 3).map((post, i) => (
            <div
              key={post.slug}
              className="h-9 w-9 overflow-hidden rounded-[5px] border border-[#2b2722] shadow-md shadow-black/40"
              style={{ transform: `rotate(${FAN_ROTATE[i] ?? "0deg"})`, zIndex: FAN_Z[i] ?? 0 }}
            >
              {post.thumbnailUrl ? (
                <img src={post.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-[#333]" />
              )}
            </div>
          ))}
        </div>

        {/* Eyebrow + one-line day/count — truncates instead of wrapping so the
            row never grows a second text line on narrow screens */}
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#8a774d]">
            On this day
          </p>
          <p className="truncate leading-tight">
            <span className="font-serif text-[16px] font-semibold text-[#efeae1] transition-colors group-hover:text-[#f7f3ea]">
              {dayLabel}
            </span>
            <span className="text-[13px] text-[#7d7468]">
              {" · "}
              {memoriesLabel}
              {/* the warm tail doesn't fit a 375px row — desktop only */}
              <span className="hidden sm:inline"> from years past</span>
            </span>
          </p>
        </div>

        {/* Chevron — hints the doorway opens downward */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 shrink-0 text-[#8a774d] transition-colors group-hover:text-[#cfae6f]"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </Link>
    </div>
  );
}
