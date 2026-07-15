import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMemoriesForDate } from "@/lib/onThisDay";
import { getSetting } from "@/lib/settings";
import { zonedNow } from "@/lib/datetime";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ posts: [] }, { status: 401 });

  const monthParam = req.nextUrl.searchParams.get("month");
  const dayParam = req.nextUrl.searchParams.get("day");

  let month: number, day: number;
  // Undefined in the explicit-params branch (back-compat: getMemoriesForDate
  // then defaults currentYear to the server year). In the no-params branch we
  // pass the *zoned* year so the same-year exclusion matches the /today page —
  // near midnight on Dec 31 the ET vs UTC year can differ, and without this the
  // teaser could surface a same-year post the page correctly excludes.
  let year: number | undefined;
  if (monthParam && dayParam) {
    // Explicit params (back-compat) — trust the caller's day.
    month = Number(monthParam);
    day = Number(dayParam);
  } else {
    // No params: resolve "today" in the album's configured timezone, the same
    // source the /today page uses, so the teaser lands on the same day.
    const timezone = (await getSetting("notify_timezone")) || "America/New_York";
    const now = zonedNow(timezone);
    month = now.month;
    day = now.day;
    year = Number(now.date.slice(0, 4));
  }

  // Page's limits (up to 6, max 2/year) so the teaser count matches the page.
  const posts = await getMemoriesForDate(month, day, year, 6, 2);
  return NextResponse.json({ posts, month, day });
}
