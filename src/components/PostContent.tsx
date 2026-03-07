"use client";

import { useState } from "react";
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

interface PostContentProps {
  media: MediaItem[];
  layout: string | null;
  title: string | null;
  body: string | null;
  dateFormatted: string;
}

export default function PostContent({
  media,
  layout,
  title,
  body,
  dateFormatted,
}: PostContentProps) {
  const [lightbox, setLightbox] = useState<{
    media: MediaItem[];
    index: number;
  } | null>(null);

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

      <div className="mt-4 px-1">
        {title && (
          <h1 className="text-[#e0e0e0] text-2xl font-medium leading-snug mb-2">
            {title}
          </h1>
        )}
        {body && (
          <div
            className="text-[#a0a0a0] text-sm leading-relaxed mb-3 post-body"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        )}
        <time className="text-[#555] text-xs tracking-wide uppercase">
          {dateFormatted}
        </time>
      </div>

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
