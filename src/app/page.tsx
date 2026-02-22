import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import LogoutButton from "@/components/LogoutButton";
import PhotoGrid from "@/components/PhotoGrid";

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

async function getFeedPosts() {
  const r2PublicUrl = process.env.R2_PUBLIC_URL!;

  const postsResult = await db.execute(
    "SELECT id, slug, title, body, date, type, photoset_layout FROM posts ORDER BY date DESC LIMIT 50"
  );

  if (postsResult.rows.length === 0) return [];

  const posts = postsResult.rows as unknown as PostRow[];
  const postIds = posts.map((p) => p.id);

  // Fetch all media for these posts in one query
  const placeholders = postIds.map(() => "?").join(",");
  const mediaResult = await db.execute({
    sql: `SELECT id, post_id, r2_key, thumbnail_r2_key, type, width, height, display_order
          FROM media WHERE post_id IN (${placeholders}) ORDER BY display_order`,
    args: postIds,
  });

  const mediaRows = mediaResult.rows as unknown as MediaRow[];

  // Group media by post_id
  const mediaByPost = new Map<string, MediaRow[]>();
  for (const m of mediaRows) {
    const arr = mediaByPost.get(m.post_id) || [];
    arr.push(m);
    mediaByPost.set(m.post_id, arr);
  }

  return posts.map((post) => ({
    ...post,
    media: (mediaByPost.get(post.id) || []).map((m) => ({
      ...m,
      url: `${r2PublicUrl}/${m.r2_key}`,
      thumbnailUrl: m.thumbnail_r2_key
        ? `${r2PublicUrl}/${m.thumbnail_r2_key}`
        : `${r2PublicUrl}/${m.r2_key}`,
    })),
  }));
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");

  const posts = await getFeedPosts();

  return (
    <main className="min-h-screen bg-[#1d1c1c]">
      <header className="border-b border-[#2a2929]">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center justify-between">
          <h1 className="text-[#d3d3d3] text-xl font-light tracking-wide">
            The Hoecks
          </h1>
          <div className="flex items-center gap-4">
            {session.role === "admin" && (
              <span className="text-xs text-[#427ea3] border border-[#427ea3] px-2 py-1 rounded">
                Admin
              </span>
            )}
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {posts.length === 0 ? (
          <p className="text-[#666] text-center py-12">
            No posts yet. The feed will appear here.
          </p>
        ) : (
          <div className="space-y-12">
            {posts.map((post) => (
              <article key={post.id} className="group">
                {/* Media */}
                {post.media.length > 0 && (
                  <PhotoGrid
                    media={post.media}
                    layout={post.photoset_layout}
                  />
                )}

                {/* Post info */}
                <div className="mt-4">
                  {post.title && (
                    <h2 className="text-[#d3d3d3] text-lg font-medium mb-1">
                      {post.title}
                    </h2>
                  )}
                  {post.body && (
                    <p className="text-[#999] text-sm leading-relaxed mb-2">
                      {post.body}
                    </p>
                  )}
                  <time className="text-[#555] text-xs">
                    {formatDate(post.date)}
                  </time>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
