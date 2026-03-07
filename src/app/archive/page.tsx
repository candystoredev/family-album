import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_ABBREVS = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface MonthRow {
  year: number;
  month: number;
  count: number;
}

export default async function ArchivePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const result = await db.execute({
    sql: `SELECT
            CAST(strftime('%Y', date) AS INTEGER) AS year,
            CAST(strftime('%m', date) AS INTEGER) AS month,
            COUNT(*) AS count
          FROM posts
          GROUP BY year, month
          ORDER BY year DESC, month DESC`,
    args: [],
  });

  const rows = result.rows as unknown as MonthRow[];

  // Group by year
  const years: { year: number; months: MonthRow[] }[] = [];
  let currentYear: (typeof years)[number] | null = null;

  for (const row of rows) {
    if (!currentYear || currentYear.year !== row.year) {
      currentYear = { year: row.year, months: [] };
      years.push(currentYear);
    }
    currentYear.months.push(row);
  }

  // Total post count
  const totalPosts = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <main className="min-h-screen bg-[#1d1c1c]">
      <header className="sticky top-0 z-10 bg-[#1d1c1c]/95 backdrop-blur-sm border-b border-[#2a2929]">
        <div className="max-w-[900px] mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
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
                Archive
              </h1>
              <p className="text-[#555] text-xs mt-0.5">
                {totalPosts} posts
              </p>
            </div>
          </div>
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
        {years.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[#555]">No posts yet.</p>
          </div>
        ) : (
          <div className="space-y-10">
            {years.map(({ year, months }) => (
              <section key={year}>
                <h2 className="text-[#d3d3d3] text-2xl font-light tracking-wide mb-4">
                  {year}
                </h2>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {months.map((m) => (
                    <Link
                      key={m.month}
                      href={`/archive/${year}/${m.month}`}
                      className="group block bg-[#252424] hover:bg-[#2e2d2d] rounded-lg p-3 transition-colors"
                    >
                      <div className="text-[#d3d3d3] text-sm font-medium group-hover:text-white transition-colors">
                        <span className="sm:hidden">{MONTH_ABBREVS[m.month]}</span>
                        <span className="hidden sm:inline">{MONTH_NAMES[m.month]}</span>
                      </div>
                      <div className="text-[#555] text-xs mt-1">
                        {m.count} {m.count === 1 ? "post" : "posts"}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
