import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getInitialFeed, getImessageRecipients } from "@/lib/feed";
import Link from "next/link";
import Feed from "@/components/Feed";

export const dynamic = "force-dynamic";

interface Album {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_url: string | null;
}

async function getAlbum(slug: string): Promise<Album | null> {
  const r2PublicUrl = process.env.R2_PUBLIC_URL!;
  const result = await db.execute({
    sql: `SELECT a.id, a.title, a.slug, a.description, m.r2_key as cover_r2_key
          FROM albums a
          LEFT JOIN media m ON m.id = a.cover_media_id
          WHERE a.slug = ?`,
    args: [slug],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as unknown as {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    cover_r2_key: string | null;
  };
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    cover_url: row.cover_r2_key ? `${r2PublicUrl}/${row.cover_r2_key}` : null,
  };
}

export default async function AlbumPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { slug } = await params;
  const album = await getAlbum(slug);
  if (!album) notFound();

  const [{ posts, nextCursor }, imessageRecipients] = await Promise.all([
    getInitialFeed({ albumId: album.id }),
    getImessageRecipients(),
  ]);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thehoecks.com";

  return (
    <main className="min-h-screen bg-[#1d1c1c]">
      <div className="max-w-[900px] mx-auto px-4 py-8">
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
              {album.title}
            </h1>
            {album.description && (
              <p className="text-[#777] text-xs mt-0.5">{album.description}</p>
            )}
            <p className="text-[#555] text-xs mt-0.5">
              {posts.length === 0
                ? "No posts"
                : `${posts.length}${nextCursor ? "+" : ""} posts`}
            </p>
          </div>
        </div>

        {/* Album cover image */}
        {album.cover_url && (
          <div className="mb-8 -mx-4 sm:mx-0">
            <div className="sm:rounded-lg overflow-hidden">
              <img
                src={album.cover_url}
                alt={`${album.title} cover`}
                className="w-full h-48 sm:h-64 object-cover"
              />
            </div>
          </div>
        )}
        {posts.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[#555]">No posts in this album yet.</p>
          </div>
        ) : (
          <Feed
            initialPosts={posts}
            initialCursor={nextCursor}
            siteUrl={siteUrl}
            imessageRecipients={imessageRecipients}
            filterParams={`album=${encodeURIComponent(album.slug)}`}
            isAdmin={session.role === "admin"}
          />
        )}
      </div>
    </main>
  );
}
