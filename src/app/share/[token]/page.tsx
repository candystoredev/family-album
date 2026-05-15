import { notFound } from "next/navigation";
import { db } from "@/lib/db";
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
}

interface MediaRow {
  id: string;
  r2_key: string;
  thumbnail_r2_key: string | null;
  type: string;
  width: number | null;
  height: number | null;
  display_order: number;
}

async function getSharedPost(token: string) {
  const r2PublicUrl = process.env.R2_PUBLIC_URL!;

  const linkResult = await db.execute({
    sql: `SELECT post_id, expires_at FROM post_share_links WHERE token = ? LIMIT 1`,
    args: [token],
  });

  if (linkResult.rows.length === 0) return { status: "invalid" as const };

  const link = linkResult.rows[0] as unknown as { post_id: string; expires_at: string | null };

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return { status: "expired" as const };
  }

  const postResult = await db.execute({
    sql: `SELECT id, slug, title, body, date, type, photoset_layout FROM posts WHERE id = ? LIMIT 1`,
    args: [link.post_id],
  });

  if (postResult.rows.length === 0) return { status: "invalid" as const };
  const post = postResult.rows[0] as unknown as PostRow;

  const mediaResult = await db.execute({
    sql: `SELECT id, r2_key, thumbnail_r2_key, type, width, height, display_order
          FROM media WHERE post_id = ? ORDER BY display_order`,
    args: [post.id],
  });

  const media = (mediaResult.rows as unknown as MediaRow[]).map((m) => ({
    id: m.id,
    type: m.type,
    url: `${r2PublicUrl}/${m.r2_key}`,
    thumbnailUrl: m.thumbnail_r2_key
      ? `${r2PublicUrl}/${m.thumbnail_r2_key}`
      : `${r2PublicUrl}/${m.r2_key}`,
    width: m.width,
    height: m.height,
  }));

  return { status: "ok" as const, post: { ...post, media } };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const result = await getSharedPost(token);
  if (result.status !== "ok") return { title: "The Hoecks" };

  const { post } = result;
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
      url: `${siteUrl}/share/${token}`,
      siteName: "The Hoecks",
      type: "article",
    },
  };
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await getSharedPost(token);

  if (result.status === "expired") {
    return (
      <main className="min-h-screen bg-[#1d1c1c] flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-[#555] text-sm">This link has expired.</p>
        </div>
      </main>
    );
  }

  if (result.status === "invalid") {
    notFound();
  }

  const { post } = result;

  return (
    <main className="min-h-screen bg-[#1d1c1c] flex flex-col">
      <article className="max-w-[900px] mx-auto w-full px-4 py-8 flex-1">
        <PostContent
          media={post.media}
          layout={post.photoset_layout}
          title={post.title}
          body={post.body}
          dateFormatted={formatDate(post.date)}
        />
      </article>
      <footer className="text-center py-6">
        <p className="text-[#333] text-xs tracking-wide uppercase">
          The Hoecks — Private family album
        </p>
      </footer>
    </main>
  );
}
