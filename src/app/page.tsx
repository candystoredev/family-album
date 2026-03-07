import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getInitialFeed, getImessageRecipients } from "@/lib/feed";
import { db } from "@/lib/db";
import SeedButton from "@/components/SeedButton";
import Feed from "@/components/Feed";
import BannerMessage from "@/components/BannerMessage";

export const dynamic = "force-dynamic";

async function getBannerMessage(): Promise<string | null> {
  try {
    const result = await db.execute({
      sql: "SELECT value FROM site_settings WHERE key = 'banner_message'",
      args: [],
    });
    if (result.rows.length > 0) {
      const val = result.rows[0].value as string;
      return val.trim() || null;
    }
  } catch {
    // Setting doesn't exist yet
  }
  return null;
}

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [{ posts, nextCursor }, imessageRecipients, bannerMessage] = await Promise.all([
    getInitialFeed(),
    getImessageRecipients(),
    getBannerMessage(),
  ]);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thehoecks.com";

  return (
    <main className="min-h-screen bg-[#1d1c1c]">
      {bannerMessage && <BannerMessage message={bannerMessage} />}

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
