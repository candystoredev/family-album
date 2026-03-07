import { NextResponse } from "next/server";
import { db } from "@/lib/db";

interface MonthRow {
  year: number;
  month: number;
  count: number;
}

export async function GET() {
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
  const years: { year: number; months: { month: number; count: number }[] }[] = [];
  let currentYear: (typeof years)[number] | null = null;

  for (const row of rows) {
    if (!currentYear || currentYear.year !== row.year) {
      currentYear = { year: row.year, months: [] };
      years.push(currentYear);
    }
    currentYear.months.push({ month: row.month, count: row.count });
  }

  return NextResponse.json({ years });
}
