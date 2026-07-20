"use client";

import { useState } from "react";
import PhotoGrid from "./PhotoGrid";
import Lightbox from "./Lightbox";
import PostActions from "./PostActions";

interface MediaItem {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
}

interface PostContentProps {
  media: MediaItem[];
  layout: string | null;
  title: string | null;
  body: string | null;
  dateFormatted: string;
  // Optional so the PUBLIC /share/[token] page can render captions WITHOUT the
  // action sheet — only the session-gated post page supplies these and gets the
  // long-press Edit/Share affordances.
  postId?: string;
  slug?: string;
  isAdmin?: boolean;
  recipients?: string[];
  siteUrl?: string;
}

export default function PostContent({
  media,
  layout,
  title,
  body,
  dateFormatted,
  postId,
  slug,
  isAdmin,
  recipients,
  siteUrl,
}: PostContentProps) {
  const [lightbox, setLightbox] = useState<{
    media: MediaItem[];
    index: number;
  } | null>(null);

  // Centered caption to match the feed: container centers title + date, while
  // the body stays left-aligned (feed uses text-left on the body inside a
  // centered container).
  const caption = (
    <>
      {title && (
        <h1 className="text-[#e0e0e0] text-2xl font-medium leading-snug mb-2">
          {title}
        </h1>
      )}
      {body && (
        <div
          className="text-[#a0a0a0] text-sm leading-relaxed mb-3 text-left post-body"
          dangerouslySetInnerHTML={{ __html: body }}
        />
      )}
      <time className="text-[#555] text-xs tracking-wide uppercase">
        {dateFormatted}
      </time>
    </>
  );

  return (
    <>
      {media.length > 0 && (
        <div className="-mx-4 sm:mx-0">
          <PhotoGrid
            media={media}
            layout={layout}
            onImageClick={(index) => setLightbox({ media, index })}
          />
        </div>
      )}

      {/* Action sheet only on the session-gated post page (all props present).
          The public share page passes none, so friends get the plain caption. */}
      {postId && slug && siteUrl && recipients ? (
        <PostActions
          postId={postId}
          slug={slug}
          title={title}
          isAdmin={isAdmin}
          recipients={recipients}
          siteUrl={siteUrl}
          className="mt-4 px-1 text-center select-none"
        >
          {caption}
        </PostActions>
      ) : (
        <div className="mt-4 px-1 text-center">{caption}</div>
      )}

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
