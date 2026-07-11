import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getInitialFeed, getImessageRecipients } from "@/lib/feed";
import Link from "next/link";
import Feed from "@/components/Feed";
import { db } from "@/lib/db";
import { EFF_DAY_SQL } from "@/lib/order";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

async function getAdjacentMonths(year: number, month: number) {
  // Find previous and next months that have posts, grouped/bounded by the
  // effective capture day (local_date ?? legacy day) — the same expression
  // getInitialFeed uses to fill this month's page — so prev/next never link
  // to a month that's actually empty under effective-day filtering (Phase 12a).
  const [prevResult, nextResult] = await Promise.all([
    db.execute({
      sql: `SELECT
              CAST(substr(eff_day, 1, 4) AS INTEGER) AS year,
              CAST(substr(eff_day, 6, 2) AS INTEGER) AS month
            FROM (SELECT ${EFF_DAY_SQL} AS eff_day FROM posts p)
            WHERE eff_day < ?
            GROUP BY year, month
            ORDER BY eff_day DESC
            LIMIT 1`,
      args: [`${year}-${String(month).padStart(2, "0")}-01`],
    }),
    db.execute({
      sql: `SELECT
              CAST(substr(eff_day, 1, 4) AS INTEGER) AS year,
              CAST(substr(eff_day, 6, 2) AS INTEGER) AS month
            FROM (SELECT ${EFF_DAY_SQL} AS eff_day FROM posts p)
            WHERE eff_day >= ?
            GROUP BY year, month
            ORDER BY eff_day ASC
            LIMIT 1`,
      args: [
        month === 12
          ? `${year + 1}-01-01`
          : `${year}-${String(month + 1).padStart(2, "0")}-01`,
      ],
    }),
  ]);

  return {
    prev: prevResult.rows.length > 0
      ? { year: prevResult.rows[0].year as number, month: prevResult.rows[0].month as number }
      : null,
    next: nextResult.rows.length > 0
      ? { year: nextResult.rows[0].year as number, month: nextResult.rows[0].month as number }
      : null,
  };
}

export default async function MonthPage({
  params,
}: {
  params: Promise<{ year: string; month: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { year: yearStr, month: monthStr } = await params;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    notFound();
  }

  const [{ posts, nextCursor }, imessageRecipients, adjacent] = await Promise.all([
    getInitialFeed({ year, month }),
    getImessageRecipients(),
    getAdjacentMonths(year, month),
  ]);

  if (posts.length === 0) notFound();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thehoecks.com";

  return (
    <main className="min-h-screen bg-[#1d1c1c]">
      <div className="max-w-[900px] mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/archive"
            className="text-[#555] hover:text-[#888] transition-colors"
            aria-label="Back to archive"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <div>
            <h1 className="text-[#d3d3d3] text-xl font-light tracking-wide">
              {MONTH_NAMES[month]} {year}
            </h1>
            <p className="text-[#555] text-xs mt-0.5">
              {posts.length}{nextCursor ? "+" : ""} posts &middot; oldest first
            </p>
          </div>
        </div>
        <Feed
          initialPosts={posts}
          initialCursor={nextCursor}
          siteUrl={siteUrl}
          imessageRecipients={imessageRecipients}
          filterParams={`year=${year}&month=${month}`}
          isAdmin={session.role === "admin"}
        />

        {/* Previous / Next month navigation */}
        <nav className="flex items-center justify-between pt-8 mt-8 border-t border-[#2a2929]">
          {adjacent.prev ? (
            <Link
              href={`/archive/${adjacent.prev.year}/${adjacent.prev.month}`}
              className="text-[#427ea3] hover:text-[#5aadde] text-sm transition-colors"
            >
              &larr; {MONTH_NAMES[adjacent.prev.month]} {adjacent.prev.year}
            </Link>
          ) : (
            <span />
          )}
          {adjacent.next ? (
            <Link
              href={`/archive/${adjacent.next.year}/${adjacent.next.month}`}
              className="text-[#427ea3] hover:text-[#5aadde] text-sm transition-colors"
            >
              {MONTH_NAMES[adjacent.next.month]} {adjacent.next.year} &rarr;
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </main>
  );
}
