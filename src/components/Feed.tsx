"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import PhotoGrid from "./PhotoGrid";
import Lightbox from "./Lightbox";

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
  tags?: { name: string; slug: string }[];
  people?: { name: string; slug: string }[];
}

interface FeedProps {
  initialPosts: Post[];
  initialCursor: string | null;
  siteUrl: string;
  imessageRecipients: string;
  filterParams?: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function Feed({
  initialPosts,
  initialCursor,
  siteUrl,
  imessageRecipients,
  filterParams,
}: FeedProps) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Lightbox state
  const [lightbox, setLightbox] = useState<{
    media: MediaItem[];
    index: number;
  } | null>(null);

  const fetchMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("cursor", cursor);
      if (filterParams) {
        const extra = new URLSearchParams(filterParams);
        extra.forEach((v, k) => params.set(k, v));
      }
      const res = await fetch(`/api/feed?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setPosts((prev) => [...prev, ...data.posts]);
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, filterParams]);

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

  const recipients = imessageRecipients
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  return (
    <>
      <div className="space-y-12">
        {posts.map((post, postIndex) => (
          <article key={post.id}>
            {postIndex > 0 && (
              <div className="flex justify-center mb-12">
                <div className="w-8 h-px bg-[#333]" />
              </div>
            )}
            {/* Media — bleed to screen edge on mobile */}
            {post.media.length > 0 && (
              <div className="-mx-4 sm:mx-0">
                <PhotoGrid
                  media={post.media}
                  layout={post.photoset_layout}
                  onImageClick={(index) =>
                    setLightbox({ media: post.media, index })
                  }
                />
              </div>
            )}

            {/* Post info */}
            <div className="mt-4 px-4 sm:px-8 text-center">
              {post.title && (
                <h2 className="text-[#e0e0e0] text-lg font-medium leading-snug mb-1.5">
                  {post.title}
                </h2>
              )}
              {post.body && (
                <div
                  className="text-[#a0a0a0] text-sm leading-relaxed mb-2 text-left post-body"
                  dangerouslySetInnerHTML={{ __html: post.body }}
                />
              )}
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <time className="text-[#555] text-xs tracking-wide uppercase">
                  {formatDate(post.date)}
                </time>
                <PostMeta tags={post.tags} people={post.people} />
              </div>

              {/* iMessage button — mobile only */}
              <div className="mt-3 lg:hidden">
                <IMessageBubble
                  recipients={recipients}
                  postUrl={`${siteUrl}/posts/${post.slug}`}
                />
              </div>
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

      {/* Lightbox overlay */}
      {lightbox && (
        <Lightbox
          media={lightbox.media}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

/** Tags and people links below the date */
function PostMeta({
  tags,
  people,
}: {
  tags?: { name: string; slug: string }[];
  people?: { name: string; slug: string }[];
}) {
  const hasTags = tags && tags.length > 0;
  const hasPeople = people && people.length > 0;
  if (!hasTags && !hasPeople) return null;

  return (
    <span className="inline-flex flex-wrap gap-x-1.5 text-xs">
      {hasPeople &&
        people.map((p) => (
          <Link
            key={p.slug}
            href={`/people/${p.slug}`}
            className="text-[#4a4a4a] hover:text-[#777] transition-colors"
          >
            @{p.name}
          </Link>
        ))}
      {hasTags &&
        tags.map((t) => (
          <Link
            key={t.slug}
            href={`/tags/${t.slug}`}
            className="text-[#4a4a4a] hover:text-[#777] transition-colors"
          >
            #{t.name}
          </Link>
        ))}
    </span>
  );
}

/** Small blue chat bubble icon for iMessage */
function IMessageBubble({
  recipients,
  postUrl,
}: {
  recipients: string[];
  postUrl: string;
}) {
  const body = `${postUrl}\n\nMy reaction:\n`;
  const recipientPart = recipients.length > 0 ? recipients.join(",") : "";
  const smsUrl = `sms:${recipientPart}&body=${encodeURIComponent(body)}`;

  return (
    <a
      href={smsUrl}
      className="shrink-0 mt-0.5 text-[#427ea3] hover:text-[#5aadde] transition-colors"
      aria-label="Text us about this"
      title="Text us about this"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm0 15.17L18.83 16H4V4h16v13.17z" />
        <circle cx="8" cy="10" r="1" />
        <circle cx="12" cy="10" r="1" />
        <circle cx="16" cy="10" r="1" />
      </svg>
    </a>
  );
}
