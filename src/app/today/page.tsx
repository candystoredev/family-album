import Link from "next/link";
import { getMemoriesForDate } from "@/lib/onThisDay";
import { getSetting } from "@/lib/settings";
import { zonedNow } from "@/lib/datetime";
import TodayMemory from "@/components/TodayMemory";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Today's Memory · The Hoecks",
};

export default async function TodayPage() {
  const timezone = (await getSetting("notify_timezone")) || "America/New_York";
  const { month, day } = zonedNow(timezone);
  // The dedicated page shows a fuller look back than the 3-post teaser:
  // up to 6 memories, still capped at 2 per year for variety.
  const memories = await getMemoriesForDate(month, day, new Date().getFullYear(), 6, 2);

  const todayLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });

  return (
    <main className="min-h-screen max-w-[900px] mx-auto px-4 sm:px-6 py-8">
      <header className="mb-6 text-center">
        <p className="text-[#666] text-xs uppercase tracking-widest mb-1">On this day</p>
        <h1 className="text-[#d3d3d3] text-2xl font-semibold">{todayLabel}</h1>
      </header>

      {memories.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-[#888] text-base mb-6">
            No memories from past years on this day — yet.
          </p>
          <Link
            href="/"
            className="inline-block text-sm text-[#427ea3] hover:text-[#5a9ec5] transition-colors"
          >
            Browse the album →
          </Link>
        </div>
      ) : (
        <>
          <TodayMemory memories={memories} />
          <div className="mt-8 text-center">
            <Link
              href="/"
              className="inline-block text-sm text-[#427ea3] hover:text-[#5a9ec5] transition-colors"
            >
              Browse the whole album →
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
