"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import PhotoGrid from "./PhotoGrid";

interface MediaItem {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
}

interface Post {
  id: string;
  slug: string;
  title: string | null;
  body: string | null;
  date: string;
  type: string;
  photoset_layout: string | null;
  media: MediaItem[];
}

interface FeedProps {
  initialPosts: Post[];
  initialCursor: string | null;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function Feed({ initialPosts, initialCursor }: FeedProps) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/feed?cursor=${encodeURIComponent(cursor)}`);
      if (!res.ok) return;
      const data = await res.json();
      setPosts((prev) => [...prev, ...data.posts]);
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchMore();
        }
      },
      { rootMargin: "600px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchMore]);

  if (posts.length === 0) return null;

  return (
    <>
      <div className="space-y-16">
        {posts.map((post) => (
          <article key={post.id}>
            {/* Media — bleed to screen edge on mobile */}
            {post.media.length > 0 && (
              <div className="-mx-4 sm:mx-0">
                <PhotoGrid media={post.media} layout={post.photoset_layout} />
              </div>
            )}

            {/* Post info */}
            <div className="mt-4 px-1">
              {post.title && (
                <h2 className="text-[#e0e0e0] text-lg font-medium leading-snug mb-1.5">
                  {post.title}
                </h2>
              )}
              {post.body && (
                <div
                  className="text-[#a0a0a0] text-sm leading-relaxed mb-2 post-body"
                  dangerouslySetInnerHTML={{ __html: post.body }}
                />
              )}
              <time className="text-[#555] text-xs tracking-wide uppercase">
                {formatDate(post.date)}
              </time>
            </div>
          </article>
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-px" />

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-[#333] border-t-[#427ea3] rounded-full animate-spin" />
        </div>
      )}

      {!cursor && posts.length > 0 && (
        <p className="text-center text-[#444] text-xs py-12 tracking-wide uppercase">
          You&rsquo;ve reached the beginning
        </p>
      )}
    </>
  );
}
