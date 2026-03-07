import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getInitialFeed, getImessageRecipients } from "@/lib/feed";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import SeedButton from "@/components/SeedButton";
import Feed from "@/components/Feed";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [{ posts, nextCursor }, imessageRecipients] = await Promise.all([
    getInitialFeed(),
    getImessageRecipients(),
  ]);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thehoecks.com";

  return (
    <main className="min-h-screen bg-[#1d1c1c]">
      <header className="sticky top-0 z-10 bg-[#1d1c1c]/95 backdrop-blur-sm border-b border-[#2a2929]">
        <div className="max-w-[900px] mx-auto px-4 py-5 flex items-center justify-between">
          <h1 className="text-[#d3d3d3] text-xl font-light tracking-wide">
            The Hoecks
          </h1>
          <div className="flex items-center gap-4">
            <Link
              href="/archive"
              className="text-[#555] hover:text-[#888] text-sm transition-colors"
            >
              Archive
            </Link>
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
          <>
            <Feed
              initialPosts={posts}
              initialCursor={nextCursor}
              siteUrl={siteUrl}
              imessageRecipients={imessageRecipients}
            />
            {session.role === "admin" && (
              <div className="flex justify-center pt-8">
                <SeedButton />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
