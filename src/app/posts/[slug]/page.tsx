import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getImessageRecipients } from "@/lib/feed";
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
      // og:image must be a still — a video file URL renders no preview at all.
      // Prefer the thumbnail so link-preview crawlers cache the small image, not
      // the full-resolution original.
      ogImageUrl: m.thumbnail_r2_key
        ? `${r2PublicUrl}/${m.thumbnail_r2_key}`
        : m.type === "video"
          ? null
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

  // The page stays reachable (so link-preview crawlers can read the OG tags in
  // generateMetadata), but the actual photos/caption are only shown to a
  // logged-in family member — otherwise post URLs would expose the whole
  // "private" album to anyone who guesses a slug.
  const session = await getSession();
  if (!session) {
    return (
      <main className="min-h-screen bg-[#1d1c1c] flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#8a774d] mb-3">
            The Hoecks
          </div>
          <h1 className="font-serif text-[26px] font-semibold text-[#efeae1] leading-snug mb-3">
            {post.title || "A private memory"}
          </h1>
          <p className="text-[#a39e93] text-sm mb-6">
            This is a private family album. Log in to view this post.
          </p>
          <Link
            href="/login"
            className="inline-block rounded-lg bg-[#c2a467] px-5 py-2.5 text-sm font-semibold text-[#1a1715] hover:bg-[#d2b577] transition-colors"
          >
            Log in
          </Link>
        </div>
      </main>
    );
  }

  const isAdmin = session.role === "admin";
  const recipients = (await getImessageRecipients())
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thehoecks.com";

  return (
    // min-h-svh (not min-h-screen) so iOS Safari's collapsing URL bar doesn't
    // skew the centering below.
    <main className="min-h-svh bg-[#1d1c1c] flex flex-col">
      {/* my-auto on this flex-column child centers short content (a single
          photo) in the viewport, but collapses to 0 once content is taller
          than the screen — multi-photo sets start at the top and scroll
          normally. No JS or per-layout branching needed. */}
      <article className="w-full max-w-[900px] mx-auto px-4 py-8 my-auto">
        <PostContent
          media={post.media}
          layout={post.photoset_layout}
          title={post.title}
          body={post.body}
          dateFormatted={formatDisplayDate(post.date, post.local_date, { long: true })}
          postId={post.id}
          slug={post.slug}
          isAdmin={isAdmin}
          recipients={recipients}
          siteUrl={siteUrl}
        />
      </article>
    </main>
  );
}
