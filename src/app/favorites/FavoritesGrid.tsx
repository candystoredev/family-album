"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getHearts, saveHearts } from "@/components/DoubleTapHeart";
import Lightbox from "@/components/Lightbox";

interface FavoriteMedia {
  id: string;
  url: string;
  thumbnailUrl: string;
  type: string;
  width: number | null;
  height: number | null;
  postSlug: string;
  postTitle: string | null;
  postDate: string;
}

export default function FavoritesGrid() {
  const [media, setMedia] = useState<FavoriteMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    const hearts = getHearts();
    if (hearts.size === 0) {
      setLoading(false);
      return;
    }

    fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaIds: [...hearts] }),
    })
      .then((r) => (r.ok ? r.json() : { media: [] }))
      .then((data) => {
        setMedia(data.media || []);
        // Clean up hearts for media that no longer exists
        const validIds = new Set((data.media || []).map((m: FavoriteMedia) => m.id));
        const cleaned = new Set([...hearts].filter((id) => validIds.has(id)));
        if (cleaned.size !== hearts.size) saveHearts(cleaned);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const removeHeart = useCallback((mediaId: string) => {
    const hearts = getHearts();
    hearts.delete(mediaId);
    saveHearts(hearts);
    setMedia((prev) => prev.filter((m) => m.id !== mediaId));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-[#333] border-t-[#427ea3] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/"
          className="text-[#555] hover:text-[#888] transition-colors"
          aria-label="Back to feed"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-[#d3d3d3] text-xl font-light tracking-wide">
            Favorites
          </h1>
          <p className="text-[#555] text-xs mt-0.5">
            {media.length === 0 ? "No favorites yet" : `${media.length} photo${media.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {media.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[#555]">
            Double-tap any photo to add it to your favorites.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 sm:gap-1.5">
          {media.map((item, index) => (
            <div key={item.id} className="relative group aspect-square">
              <img
                src={item.thumbnailUrl}
                alt={item.postTitle || ""}
                className="w-full h-full object-cover cursor-pointer rounded-sm"
                onClick={() => setLightbox(index)}
              />
              {/* Remove heart button on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeHeart(item.id);
                }}
                className="absolute top-1 right-1 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300"
                aria-label="Remove from favorites"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {lightbox !== null && (
        <Lightbox
          media={media.map((m) => ({
            id: m.id,
            type: m.type,
            url: m.url,
            thumbnailUrl: m.thumbnailUrl,
            width: m.width,
            height: m.height,
          }))}
          initialIndex={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}
