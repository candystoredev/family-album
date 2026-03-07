import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getInitialFeed, getImessageRecipients } from "@/lib/feed";
import Link from "next/link";
import Feed from "@/components/Feed";

export const dynamic = "force-dynamic";

async function getTag(slug: string) {
  const result = await db.execute({
    sql: "SELECT id, name, slug FROM tags WHERE slug = ?",
    args: [slug],
  });
  if (result.rows.length === 0) return null;
  return result.rows[0] as unknown as { id: string; name: string; slug: string };
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { slug } = await params;
  const tag = await getTag(slug);
  if (!tag) notFound();

  const [{ posts, nextCursor }, imessageRecipients] = await Promise.all([
    getInitialFeed({ tagId: tag.id }),
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
              #{tag.name}
            </h1>
            <p className="text-[#555] text-xs mt-0.5">
              {posts.length === 0
                ? "No posts"
                : `${posts.length}${nextCursor ? "+" : ""} posts`}
            </p>
          </div>
        </div>
        {posts.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[#555]">No posts with this tag yet.</p>
          </div>
        ) : (
          <Feed
            initialPosts={posts}
            initialCursor={nextCursor}
            siteUrl={siteUrl}
            imessageRecipients={imessageRecipients}
            filterParams={`tag=${encodeURIComponent(tag.slug)}`}
          />
        )}
      </div>
    </main>
  );
}
