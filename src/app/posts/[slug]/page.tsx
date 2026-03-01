import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import PhotoGrid from "@/components/PhotoGrid";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

interface PostRow {
  id: string;
  slug: string;
  title: string | null;
  body: string | null;
  date: string;
  type: string;
  photoset_layout: string | null;
}

interface MediaRow {
  id: string;
  post_id: string;
  r2_key: string;
  thumbnail_r2_key: string | null;
  type: string;
  width: number | null;
  height: number | null;
  display_order: number;
}

async function getPost(slug: string) {
  const r2PublicUrl = process.env.R2_PUBLIC_URL!;

  const result = await db.execute({
    sql: `SELECT id, slug, title, body, date, type, photoset_layout
          FROM posts WHERE slug = ? LIMIT 1`,
    args: [slug],
  });

  if (result.rows.length === 0) return null;
  const post = result.rows[0] as unknown as PostRow;

  const mediaResult = await db.execute({
    sql: `SELECT id, post_id, r2_key, thumbnail_r2_key, type, width, height, display_order
          FROM media WHERE post_id = ? ORDER BY display_order`,
    args: [post.id],
  });
  const mediaRows = mediaResult.rows as unknown as MediaRow[];

  return {
    ...post,
    media: mediaRows.map((m) => ({
      id: m.id,
      type: m.type,
      url: `${r2PublicUrl}/${m.r2_key}`,
      thumbnailUrl: m.thumbnail_r2_key
        ? `${r2PublicUrl}/${m.thumbnail_r2_key}`
        : `${r2PublicUrl}/${m.r2_key}`,
      width: m.width,
      height: m.height,
    })),
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: "Not Found" };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thehoecks.com";
  const date = new Date(post.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    title: post.title ? `${post.title} — The Hoecks` : "The Hoecks",
    robots: { index: false, follow: false },
    openGraph: {
      title: post.title || "The Hoecks",
      description: `Posted ${date}`,
      images: post.media.length > 0 ? [{ url: post.media[0].url }] : [],
      url: `${siteUrl}/posts/${post.slug}`,
      siteName: "The Hoecks",
      type: "article",
    },
  };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  return (
    <main className="min-h-screen bg-[#1d1c1c]">
      <header className="sticky top-0 z-10 bg-[#1d1c1c]/95 backdrop-blur-sm border-b border-[#2a2929]">
        <div className="max-w-[900px] mx-auto px-4 py-5 flex items-center justify-between">
          <a
            href="/"
            className="text-[#d3d3d3] text-xl font-light tracking-wide hover:text-white transition-colors"
          >
            The Hoecks
          </a>
        </div>
      </header>

      <article className="max-w-[900px] mx-auto px-4 py-8">
        {/* Media — bleed to screen edge on mobile */}
        {post.media.length > 0 && (
          <div className="-mx-4 sm:mx-0">
            <PhotoGrid media={post.media} layout={post.photoset_layout} />
          </div>
        )}

        {/* Post info */}
        <div className="mt-4 px-1">
          {post.title && (
            <h1 className="text-[#e0e0e0] text-2xl font-medium leading-snug mb-2">
              {post.title}
            </h1>
          )}
          {post.body && (
            <div
              className="text-[#a0a0a0] text-sm leading-relaxed mb-3 post-body"
              dangerouslySetInnerHTML={{ __html: post.body }}
            />
          )}
          <time className="text-[#555] text-xs tracking-wide uppercase">
            {formatDate(post.date)}
          </time>
        </div>
      </article>
    </main>
  );
}
