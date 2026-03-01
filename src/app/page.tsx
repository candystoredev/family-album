import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import LogoutButton from "@/components/LogoutButton";
import SeedButton from "@/components/SeedButton";
import Feed from "@/components/Feed";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

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

function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`).toString("base64url");
}

async function getInitialFeed() {
  const r2PublicUrl = process.env.R2_PUBLIC_URL!;

  const result = await db.execute({
    sql: `SELECT id, slug, title, body, date, type, photoset_layout
          FROM posts ORDER BY date DESC, id DESC LIMIT ?`,
    args: [PAGE_SIZE + 1],
  });

  let posts = result.rows as unknown as PostRow[];

  let nextCursor: string | null = null;
  if (posts.length > PAGE_SIZE) {
    posts = posts.slice(0, PAGE_SIZE);
    const last = posts[posts.length - 1];
    nextCursor = encodeCursor(last.date, last.id);
  }

  if (posts.length === 0) return { posts: [], nextCursor: null };

  // Fetch all media for these posts in one query
  const postIds = posts.map((p) => p.id);
  const placeholders = postIds.map(() => "?").join(",");
  const mediaResult = await db.execute({
    sql: `SELECT id, post_id, r2_key, thumbnail_r2_key, type, width, height, display_order
          FROM media WHERE post_id IN (${placeholders}) ORDER BY display_order`,
    args: postIds,
  });
  const mediaRows = mediaResult.rows as unknown as MediaRow[];

  const mediaByPost = new Map<string, MediaRow[]>();
  for (const m of mediaRows) {
    const arr = mediaByPost.get(m.post_id) || [];
    arr.push(m);
    mediaByPost.set(m.post_id, arr);
  }

  const postsWithMedia = posts.map((post) => ({
    ...post,
    media: (mediaByPost.get(post.id) || []).map((m) => ({
      id: m.id,
      type: m.type,
      url: `${r2PublicUrl}/${m.r2_key}`,
      thumbnailUrl: m.thumbnail_r2_key
        ? `${r2PublicUrl}/${m.thumbnail_r2_key}`
        : `${r2PublicUrl}/${m.r2_key}`,
      width: m.width,
      height: m.height,
    })),
  }));

  return { posts: postsWithMedia, nextCursor };
}

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { posts, nextCursor } = await getInitialFeed();

  return (
    <main className="min-h-screen bg-[#1d1c1c]">
      <header className="sticky top-0 z-10 bg-[#1d1c1c]/95 backdrop-blur-sm border-b border-[#2a2929]">
        <div className="max-w-[900px] mx-auto px-4 py-5 flex items-center justify-between">
          <h1 className="text-[#d3d3d3] text-xl font-light tracking-wide">
            The Hoecks
          </h1>
          <div className="flex items-center gap-4">
            {session.role === "admin" && (
              <span className="text-[10px] text-[#427ea3] border border-[#427ea3]/40 px-2 py-0.5 rounded uppercase tracking-wider">
                Admin
              </span>
            )}
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="max-w-[900px] mx-auto px-4 py-8">
        {posts.length === 0 ? (
          <div className="text-center py-16 space-y-6">
            <p className="text-[#555]">
              No posts yet. The feed will appear here.
            </p>
            {session.role === "admin" && <SeedButton />}
          </div>
        ) : (
          <Feed initialPosts={posts} initialCursor={nextCursor} />
        )}
      </div>
    </main>
  );
}
