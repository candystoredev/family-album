import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EFF_DAY_SQL } from "@/lib/order";

interface MonthRow {
  year: number;
  month: number;
  count: number;
}

interface AlbumRow {
  slug: string;
  title: string;
}

export async function GET() {
  const [monthsResult, albumsResult] = await Promise.all([
    db.execute({
      // Group by the effective capture day (local_date ?? legacy day) so the
      // archive timeline matches the feed's ordering/grouping (Phase 10.2b).
      sql: `SELECT
              CAST(substr(eff_day, 1, 4) AS INTEGER) AS year,
              CAST(substr(eff_day, 6, 2) AS INTEGER) AS month,
              COUNT(*) AS count
            FROM (SELECT ${EFF_DAY_SQL} AS eff_day FROM posts p)
            GROUP BY year, month
            ORDER BY year DESC, month DESC`,
      args: [],
    }),
    db.execute({
      sql: `SELECT slug, title FROM albums ORDER BY title`,
      args: [],
    }),
  ]);

  const rows = monthsResult.rows as unknown as MonthRow[];

  // Group by year
  const years: { year: number; months: { month: number; count: number }[] }[] = [];
  let currentYear: (typeof years)[number] | null = null;

  for (const row of rows) {
    if (!currentYear || currentYear.year !== row.year) {
      currentYear = { year: row.year, months: [] };
      years.push(currentYear);
    }
    currentYear.months.push({ month: row.month, count: row.count });
  }

  const albums = albumsResult.rows as unknown as AlbumRow[];

  return NextResponse.json({ years, albums });
}
