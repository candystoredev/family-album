"use client";

import { useState } from "react";
import DoubleTapHeart from "./DoubleTapHeart";

interface MediaItem {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
}

interface PhotoGridProps {
  media: MediaItem[];
  layout: string | null;
  onImageClick?: (index: number) => void;
}

function FadeImage({
  src,
  alt,
  className,
  style,
  onClick,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={`${className} ${loaded ? "img-loaded" : "img-loading"}`}
      style={style}
      onClick={onClick}
      onLoad={() => setLoaded(true)}
    />
  );
}

export default function PhotoGrid({ media, layout, onImageClick }: PhotoGridProps) {
  if (media.length === 0) return null;

  // Single photo — full width
  if (media.length === 1) {
    const item = media[0];
    return (
      <div className="sm:rounded-lg overflow-hidden">
        {item.type === "video" ? (
          <video
            src={item.url}
            poster={item.thumbnailUrl}
            controls
            playsInline
            className="w-full"
          />
        ) : (
          <DoubleTapHeart
            mediaId={item.id}
            onClick={() => onImageClick?.(0)}
          >
            <FadeImage
              src={item.url}
              alt=""
              className="w-full h-auto cursor-pointer"
            />
          </DoubleTapHeart>
        )}
      </div>
    );
  }

  // Multi-photo: use photoset_layout if available, otherwise auto-layout
  const rows = parseLayout(layout, media.length);
  let mediaIndex = 0;

  return (
    <div className="flex flex-col gap-1 sm:rounded-lg overflow-hidden">
      {rows.map((count, rowIdx) => {
        const startIdx = mediaIndex;
        const rowMedia = media.slice(mediaIndex, mediaIndex + count);
        mediaIndex += count;
        return (
          <div key={rowIdx} className="flex gap-1">
            {rowMedia.map((item, itemIdx) => (
              <div
                key={item.id}
                className="flex-1 min-w-0"
                style={{ flex: `1 1 ${100 / count}%` }}
              >
                {item.type === "video" ? (
                  <video
                    src={item.url}
                    poster={item.thumbnailUrl}
                    controls
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <DoubleTapHeart
                    mediaId={item.id}
                    onClick={() => onImageClick?.(startIdx + itemIdx)}
                    className="h-full"
                  >
                    <FadeImage
                      src={item.url}
                      alt=""
                      className="w-full h-full object-cover cursor-pointer"
                      style={{ aspectRatio: count > 1 ? "4/3" : undefined }}
                    />
                  </DoubleTapHeart>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Parse Tumblr photoset_layout string (e.g., "212" → [2, 1, 2]) or auto-calculate */
function parseLayout(layout: string | null, count: number): number[] {
  if (layout) {
    const rows = layout.split("").map(Number).filter((n) => n > 0);
    const total = rows.reduce((a, b) => a + b, 0);
    if (total === count) return rows;
  }

  // Auto-layout fallback
  if (count <= 2) return [count];
  if (count === 3) return [2, 1];
  if (count === 4) return [2, 2];
  // 5+: rows of 2-3
  const rows: number[] = [];
  let remaining = count;
  while (remaining > 0) {
    if (remaining >= 3) {
      rows.push(3);
      remaining -= 3;
    } else {
      rows.push(remaining);
      remaining = 0;
    }
  }
  return rows;
}
