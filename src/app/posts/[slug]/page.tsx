import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDisplayDate } from "@/lib/datetime";
import PostContent from "@/components/PostContent";
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
  local_date: string | null;
  date_source: string | null;
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
    sql: `SELECT id, slug, title, body, date, type, photoset_layout, local_date, date_source
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
      // og:image must be a still — a video file URL renders no preview at all,
      // so videos contribute their poster frame or nothing.
      ogImageUrl:
        m.type === "video"
          ? m.thumbnail_r2_key
            ? `${r2PublicUrl}/${m.thumbnail_r2_key}`
            : null
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
  const date = formatDisplayDate(post.date, post.local_date, { long: true });
  const ogImage = post.media.map((m) => m.ogImageUrl).find(Boolean);

  return {
    title: post.title ? `${post.title} — The Hoecks` : "The Hoecks",
    robots: { index: false, follow: false },
    openGraph: {
      title: post.title || "The Hoecks",
      description: `Posted ${date}`,
      images: ogImage ? [{ url: ogImage }] : [],
      url: `${siteUrl}/posts/${post.slug}`,
      siteName: "The Hoecks",
      type: "article",
    },
  };
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
      <article className="max-w-[900px] mx-auto px-4 py-8">
        <PostContent
          media={post.media}
          layout={post.photoset_layout}
          title={post.title}
          body={post.body}
          dateFormatted={formatDisplayDate(post.date, post.local_date, { long: true })}
        />
      </article>
    </main>
  );
}
