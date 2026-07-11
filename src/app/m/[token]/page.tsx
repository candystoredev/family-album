import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { ensureDayShareSchema } from "@/lib/schema";
import { isShareLinkUsable } from "@/lib/shareLinks";
import { getMemoriesForDate, type OnThisDayPost } from "@/lib/onThisDay";
import TodayMemory from "@/components/TodayMemory";

export const dynamic = "force-dynamic";

interface DayShare {
  year: number;
  month: number;
  day: number;
}

async function getDayShare(token: string): Promise<DayShare | null> {
  await ensureDayShareSchema();
  const result = await db.execute({
    sql: `SELECT year, month, day, revoked FROM day_share_links WHERE token = ? LIMIT 1`,
    args: [token],
  });
  if (result.rows.length === 0) return null;
  const share = result.rows[0] as unknown as DayShare & { revoked: number | boolean | null };
  if (!isShareLinkUsable({ revoked: share.revoked, expires_at: undefined }, Date.now())) {
    return null;
  }
  return share;
}

function dayLabel(share: DayShare): string {
  return new Date(Date.UTC(share.year, share.month - 1, share.day)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

async function loadMemories(share: DayShare): Promise<OnThisDayPost[]> {
  return getMemoriesForDate(share.month, share.day, share.year, 6, 2);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const share = await getDayShare(token);
  if (!share) return { title: "The Hoecks" };

  const label = dayLabel(share);
  const memories = await loadMemories(share);
  const ogImage = memories.map((mem) => mem.thumbnailUrl).find(Boolean);
  const count = memories.length;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thehoecks.com";
  const description =
    count > 0
      ? `${count} ${count === 1 ? "memory" : "memories"} from years past on ${label}.`
      : `A look back at ${label}.`;

  return {
    title: `On this day · ${label} — The Hoecks`,
    robots: { index: false, follow: false },
    openGraph: {
      title: `On this day · ${label}`,
      description,
      images: ogImage ? [{ url: ogImage }] : [],
      url: `${siteUrl}/m/${token}`,
      siteName: "The Hoecks",
      type: "article",
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: `On this day · ${label}`,
      description,
      images: ogImage ? [ogImage] : [],
    },
  };
}

export default async function MemorySharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = await getDayShare(token);
  if (!share) notFound();

  const label = dayLabel(share);
  const memories = await loadMemories(share);

  return (
    <main className="relative paper-grain min-h-screen max-w-[680px] mx-auto px-5 sm:px-6 pt-14 pb-12">
      <div className="relative">
        <header className="mb-7 text-center">
          <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#8a774d] mb-2">
            On this day
          </p>
          <h1 className="font-serif text-[32px] font-semibold tracking-[-0.01em] text-[#efeae1]">
            {label}
          </h1>
          <p className="text-[13px] text-[#7d7468] mt-1.5 tabular-nums">{share.year}</p>
        </header>

        {memories.length === 0 ? (
          <p className="text-center text-[#a39e93] text-base py-20">
            No memories from past years on this day.
          </p>
        ) : (
          <TodayMemory memories={memories} referenceYear={share.year} />
        )}

        <footer className="mt-10 text-center">
          <Link
            href="/"
            className="inline-block text-sm font-medium text-[#cfae6f] hover:text-[#d2b577] transition-colors"
          >
            The Hoecks — open the family album →
          </Link>
        </footer>
      </div>
    </main>
  );
}
