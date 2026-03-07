"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface OnThisDayPost {
  slug: string;
  title: string | null;
  date: string;
  thumbnailUrl: string | null;
}

export default function OnThisDay() {
  const [posts, setPosts] = useState<OnThisDayPost[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    fetch(`/api/on-this-day?month=${month}&day=${day}`)
      .then((r) => (r.ok ? r.json() : { posts: [] }))
      .then((data) => setPosts(data.posts || []))
      .catch(() => {});
  }, []);

  if (posts.length === 0) return null;

  const count = posts.length;
  const label = count === 1 ? "1 memory" : `${count} memories`;

  return (
    <div className="mb-8">
      {/* Compact teaser bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 sm:px-0 group"
      >
        {/* Thumbnail peek */}
        <div className="flex -space-x-2 shrink-0">
          {posts.slice(0, 3).map((post, i) =>
            post.thumbnailUrl ? (
              <img
                key={post.slug}
                src={post.thumbnailUrl}
                alt=""
                className="w-8 h-8 rounded-full object-cover border-2 border-[#1d1c1c]"
                style={{ zIndex: 3 - i }}
              />
            ) : (
              <div
                key={post.slug}
                className="w-8 h-8 rounded-full bg-[#333] border-2 border-[#1d1c1c]"
                style={{ zIndex: 3 - i }}
              />
            )
          )}
        </div>

        <span className="text-[#888] text-sm group-hover:text-[#aaa] transition-colors">
          <span className="text-[#d3d3d3] group-hover:text-white transition-colors">
            On this day
          </span>
          {" \u00B7 "}
          {label} from years past
        </span>

        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={`w-4 h-4 text-[#555] ml-auto shrink-0 transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Expandable posts */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          expanded ? "max-h-[400px] opacity-100 mt-3" : "max-h-0 opacity-0"
        }`}
      >
        <div className="flex gap-3 px-4 sm:px-0 overflow-x-auto pb-2 scrollbar-hide">
          {posts.map((post) => {
            const d = new Date(post.date);
            const yearsAgo = new Date().getFullYear() - d.getFullYear();
            const timeLabel =
              yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
            return (
              <Link
                key={post.slug}
                href={`/posts/${post.slug}`}
                className="shrink-0 group/card"
              >
                <div className="w-28 rounded-lg overflow-hidden bg-[#252424] border border-[#333] group-hover/card:border-[#555] transition-colors">
                  {post.thumbnailUrl ? (
                    <img
                      src={post.thumbnailUrl}
                      alt=""
                      className="w-28 h-20 object-cover"
                    />
                  ) : (
                    <div className="w-28 h-20 bg-[#333]" />
                  )}
                  <div className="px-2 py-1.5">
                    <p className="text-[#d3d3d3] text-[11px] leading-tight truncate group-hover/card:text-white transition-colors">
                      {post.title || timeLabel}
                    </p>
                    <p className="text-[#555] text-[10px]">{timeLabel}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
