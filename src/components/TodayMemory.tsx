"use client";

import { useState } from "react";
import Link from "next/link";
import PhotoGrid from "./PhotoGrid";
import Lightbox from "./Lightbox";
import PostActions from "./PostActions";
import { formatDisplayDate } from "@/lib/datetime";

interface MediaItem {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
}

interface Memory {
  /** Post id, for the action sheet (edit link + share mint). Optional because
   *  the public /m/[token] day-share page strips it from its payload — no
   *  internal ids on public surfaces. Without it, no action sheet renders. */
  id?: string;
  slug: string;
  title: string | null;
  body: string | null;
  date: string;
  /** Effective capture day (tz-independent `YYYY-MM-DD`); see lib/onThisDay.ts. */
  localDate: string;
  photosetLayout: string | null;
  thumbnailUrl: string | null;
  media: MediaItem[];
}

/**
 * "On This Day" view — the destination when a family member taps the daily push
 * notification or the sidebar link. Shows each memory's photos/videos with
 * caption and "X years ago", reusing the same PhotoGrid + Lightbox as the feed.
 *
 * `referenceYear` anchors the "X years ago" labels (defaults to the current
 * year). A date-pinned shared link passes its own year so the labels stay
 * correct whenever the link is opened.
 */
export default function TodayMemory({
  memories,
  referenceYear,
  isAdmin,
  recipients,
  siteUrl,
}: {
  memories: Memory[];
  referenceYear?: number;
  // Optional so the PUBLIC /m/[token] day-share page can render memories WITHOUT
  // the action sheet — friends shouldn't see Edit/Share. Only the session-gated
  // /today surfaces (page + intercepted sheet) supply these.
  isAdmin?: boolean;
  recipients?: string[];
  siteUrl?: string;
}) {
  const [lightbox, setLightbox] = useState<{ media: MediaItem[]; index: number } | null>(null);
  const baseYear = referenceYear ?? new Date().getFullYear();

  return (
    <div className="space-y-6">
      {memories.map((memory) => {
        // Year math off the tz-independent effective day, not
        // `new Date(memory.date)` (which can shift near midnight/DST).
        const yearsAgo = baseYear - Number(memory.localDate.slice(0, 4));
        const timeLabel = yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
        const dateFormatted = formatDisplayDate(memory.date, memory.localDate, { long: true });

        const caption = (
          <>
            <p className="text-[#8a774d] text-[11px] font-bold uppercase tracking-[0.16em] mb-2">
              {timeLabel} &middot; {dateFormatted}
            </p>
            {memory.title && (
              <p className="font-serif text-[19px] font-semibold text-[#f0ebe2] leading-snug mb-1">
                {memory.title}
              </p>
            )}
            {memory.body && (
              <div
                className="text-[#a39e93] text-sm leading-relaxed post-body"
                dangerouslySetInnerHTML={{ __html: memory.body }}
              />
            )}
            <Link
              href={`/posts/${memory.slug}`}
              className="inline-block mt-3 text-xs font-semibold text-[#cfae6f] hover:text-[#d2b577] transition-colors"
            >
              View full post →
            </Link>
          </>
        );

        return (
          <article
            key={memory.slug}
            className="rounded-[18px] overflow-hidden bg-[#211e1a] border border-[#2b2722]"
            style={{ boxShadow: "0 8px 26px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.04)" }}
          >
            {memory.media.length > 0 && (
              <div className="overflow-hidden">
                <PhotoGrid
                  media={memory.media}
                  layout={memory.photosetLayout}
                  onImageClick={(idx) => setLightbox({ media: memory.media, index: idx })}
                />
              </div>
            )}

            {/* Session-gated /today surfaces get the shared action sheet (long-
                press / right-click → Edit / Share / View post). The visible
                "View full post →" link stays — redundant with the sheet's "View
                post" item but matches the feed and existing muscle memory.
                select-none so a hold doesn't select the caption text. The PUBLIC
                /m/[token] page passes no recipients/siteUrl, so friends get the
                plain caption with no Edit/Share. */}
            {recipients && siteUrl && memory.id ? (
              <PostActions
                postId={memory.id}
                slug={memory.slug}
                title={memory.title}
                isAdmin={isAdmin}
                recipients={recipients}
                siteUrl={siteUrl}
                viewPostHref={`/posts/${memory.slug}`}
                className="px-5 py-5 text-center select-none"
              >
                {caption}
              </PostActions>
            ) : (
              <div className="px-5 py-5 text-center">{caption}</div>
            )}
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
