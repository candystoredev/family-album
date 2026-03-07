"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Feed from "@/components/Feed";
import LogoutButton from "@/components/LogoutButton";

interface Post {
  id: string;
  slug: string;
  title: string | null;
  body: string | null;
  date: string;
  type: string;
  photoset_layout: string | null;
  media: {
    id: string;
    type: string;
    url: string;
    thumbnailUrl: string;
    width: number | null;
    height: number | null;
  }[];
  tags?: { name: string; slug: string }[];
  people?: { name: string; slug: string }[];
}

interface SearchResultsProps {
  initialQuery: string;
  siteUrl: string;
  imessageRecipients: string;
  isAdmin: boolean;
}

export default function SearchResults({
  initialQuery,
  siteUrl,
  imessageRecipients,
  isAdmin,
}: SearchResultsProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(
    async (q: string, offset = 0) => {
      if (!q.trim()) return;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q.trim())}&offset=${offset}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (offset === 0) {
          setPosts(data.posts);
        } else {
          setPosts((prev) => [...prev, ...data.posts]);
        }
        setTotal(data.total);
        setHasMore(data.hasMore);
        setSearched(true);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Search on initial load if query present
  useEffect(() => {
    if (initialQuery) {
      search(initialQuery);
    } else {
      // Focus input when no query
      inputRef.current?.focus();
    }
  }, [initialQuery, search]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    // Update URL without full navigation
    router.replace(`/search?q=${encodeURIComponent(trimmed)}`, {
      scroll: false,
    });
    setPosts([]);
    search(trimmed);
  }

  function handleLoadMore() {
    search(query, posts.length);
  }

  return (
    <>
      <header className="sticky top-0 z-10 bg-[#1d1c1c]/95 backdrop-blur-sm border-b border-[#2a2929]">
        <div className="max-w-[900px] mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="shrink-0 text-[#555] hover:text-[#888] transition-colors"
              aria-label="Back to feed"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="w-5 h-5"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>

            <form onSubmit={handleSubmit} className="flex-1 flex gap-2">
              <div className="relative flex-1">
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
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search posts..."
                  className="w-full bg-[#252424] text-[#d3d3d3] text-sm rounded-lg pl-10 pr-4 py-2.5 border border-[#333] focus:border-[#427ea3] focus:outline-none transition-colors placeholder:text-[#555]"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            </form>

            <div className="shrink-0 flex items-center gap-4">
              {isAdmin && (
                <span className="text-[10px] text-[#427ea3] border border-[#427ea3]/40 px-2 py-0.5 rounded uppercase tracking-wider">
                  Admin
                </span>
              )}
              <LogoutButton />
            </div>
          </div>

          {searched && (
            <p className="text-[#555] text-xs mt-2 pl-8">
              {total === 0
                ? "No results found"
                : `${total} result${total === 1 ? "" : "s"}`}
            </p>
          )}
        </div>
      </header>

      <div className="max-w-[900px] mx-auto px-4 py-8">
        {loading && posts.length === 0 && (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#333] border-t-[#427ea3] rounded-full animate-spin" />
          </div>
        )}

        {!searched && !loading && (
          <div className="text-center py-16">
            <p className="text-[#555]">
              Search by title, caption, tag, or person name.
            </p>
          </div>
        )}

        {searched && total === 0 && !loading && (
          <div className="text-center py-16">
            <p className="text-[#555]">
              No posts match &ldquo;{initialQuery}&rdquo;
            </p>
          </div>
        )}

        {posts.length > 0 && (
          <>
            <Feed
              initialPosts={posts}
              initialCursor={null}
              siteUrl={siteUrl}
              imessageRecipients={imessageRecipients}
            />

            {hasMore && (
              <div className="flex justify-center pt-8">
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="text-[#427ea3] hover:text-[#5aadde] text-sm transition-colors disabled:opacity-50"
                >
                  {loading ? "Loading..." : "Load more results"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
