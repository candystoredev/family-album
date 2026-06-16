"use client";

import { useState } from "react";
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

interface Memory {
  slug: string;
  title: string | null;
  body: string | null;
  date: string;
  photosetLayout: string | null;
  thumbnailUrl: string | null;
  media: MediaItem[];
}

/**
 * Full-screen "Today's Memory" view — the destination when a family member
 * taps the daily push notification. Shows each memory's photos/videos with
 * caption and "X years ago", reusing the same PhotoGrid + Lightbox as the feed.
 */
export default function TodayMemory({ memories }: { memories: Memory[] }) {
  const [lightbox, setLightbox] = useState<{ media: MediaItem[]; index: number } | null>(null);
  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-8">
      {memories.map((memory) => {
        const d = new Date(memory.date);
        const yearsAgo = currentYear - d.getFullYear();
        const timeLabel = yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
        const dateFormatted = d.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        });

        return (
          <article
            key={memory.slug}
            className="rounded-lg overflow-hidden bg-[#252424] border border-[#333]"
          >
            {memory.media.length > 0 && (
              <div className="rounded-t-lg overflow-hidden">
                <PhotoGrid
                  media={memory.media}
                  layout={memory.photosetLayout}
                  onImageClick={(idx) => setLightbox({ media: memory.media, index: idx })}
                />
              </div>
            )}

            <div className="px-4 py-4 text-center">
              <p className="text-[#888] text-xs mb-1">
                {timeLabel} &middot; {dateFormatted}
              </p>
              {memory.title && (
                <p className="text-[#e0e0e0] text-base font-medium leading-snug mb-1">
                  {memory.title}
                </p>
              )}
              {memory.body && (
                <div
                  className="text-[#a0a0a0] text-sm leading-relaxed post-body"
                  dangerouslySetInnerHTML={{ __html: memory.body }}
                />
              )}
              <Link
                href={`/posts/${memory.slug}`}
                className="inline-block mt-3 text-xs text-[#427ea3] hover:text-[#5a9ec5] transition-colors"
              >
                View full post →
              </Link>
            </div>
          </article>
        );
      })}

      {lightbox && (
        <Lightbox
          media={lightbox.media}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
