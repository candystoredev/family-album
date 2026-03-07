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

  return (
    <div className="mb-10 px-4 sm:px-0">
      <div className="rounded-xl bg-[#252424] border border-[#333] px-5 py-4">
        <p className="text-[#888] text-xs uppercase tracking-widest mb-3">
          On this day
        </p>
        <div className="space-y-3">
          {posts.map((post) => {
            const d = new Date(post.date);
            const yearsAgo = new Date().getFullYear() - d.getFullYear();
            const label = yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
            return (
              <Link
                key={post.slug}
                href={`/posts/${post.slug}`}
                className="flex items-center gap-3 group"
              >
                {post.thumbnailUrl && (
                  <img
                    src={post.thumbnailUrl}
                    alt=""
                    className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <p className="text-[#d3d3d3] text-sm group-hover:text-white transition-colors truncate">
                    {post.title || label}
                  </p>
                  <p className="text-[#555] text-xs">{label}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
