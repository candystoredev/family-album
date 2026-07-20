import Link from "next/link";
import { getMemoriesForDate } from "@/lib/onThisDay";
import { getSetting } from "@/lib/settings";
import { getSession } from "@/lib/auth";
import { getImessageRecipients } from "@/lib/feed";
import { zonedNow } from "@/lib/datetime";
import TodayMemory from "@/components/TodayMemory";
import ShareDayButton from "@/components/ShareDayButton";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The "On This Day" body, shared by the full /today page (variant "page") and
 * the intercepting-route slide-down sheet (variant "sheet"). All the date logic
 * lives here so both surfaces stay in lockstep — a hard load of /today and the
 * sheet opened over the feed resolve the same day, memories and labels.
 */
export default async function TodayContent({
  dateParam,
  variant,
}: {
  dateParam?: string;
  variant: "page" | "sheet";
}) {
  // A `?date=YYYY-MM-DD` param pins the page to a specific day so a shared link
  // always shows the same memories, not "today" relative to when it's opened.
  // No param → the live current-day view (nav link + push notification).
  const match = dateParam?.match(DATE_RE);
  let year: number, month: number, day: number, pinned: boolean;
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
    pinned = true;
  } else {
    const timezone = (await getSetting("notify_timezone")) || "America/New_York";
    const now = zonedNow(timezone);
    year = Number(now.date.slice(0, 4));
    month = now.month;
    day = now.day;
    pinned = false;
  }

  // Up to 6 memories (still max 2/year). `year` is the reference for both
  // excluding same-year posts and the "X years ago" labels, so a shared/pinned
  // day stays consistent whenever it's opened. Session + recipients are fetched
  // alongside (neither depends on the date) to plumb the caption action sheet.
  // Middleware session-gates /today, so `session` is normally present; the `?.`
  // keeps the logged-out edge safe.
  const [memories, session, recipientsRaw] = await Promise.all([
    getMemoriesForDate(month, day, year, 6, 2),
    getSession(),
    getImessageRecipients(),
  ]);
  const isAdmin = session?.role === "admin";
  const recipients = recipientsRaw.split(",").map((n) => n.trim()).filter(Boolean);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thehoecks.com";

  const dayLabel = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const shareDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // The sheet is `fixed inset-0` and escapes the body's safe-area padding, so it
  // pads for the notch itself. "Browse the album" links are omitted in the sheet:
  // a soft nav to "/" doesn't clear the @modal slot when already on "/", which
  // would strand the sheet open — the X handles "back to feed" instead.
  const isSheet = variant === "sheet";

  const inner = (
    <div className="relative">
      <header className="mb-7 text-center">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#8a774d] mb-2">
          On this day
        </p>
        <h1 className="font-serif text-[32px] font-semibold tracking-[-0.01em] text-[#efeae1]">
          {dayLabel}
        </h1>
        {pinned && (
          <p className="text-[13px] text-[#7d7468] mt-1.5 tabular-nums">{year}</p>
        )}
      </header>

      {memories.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-[#a39e93] text-base mb-6">
            No memories from past years on this day — yet.
          </p>
          {!isSheet && (
            <Link
              href="/"
              className="inline-block text-sm font-medium text-[#cfae6f] hover:text-[#d2b577] transition-colors"
            >
              Browse the album →
            </Link>
          )}
        </div>
      ) : (
        <>
          <TodayMemory
            memories={memories}
            referenceYear={year}
            isAdmin={isAdmin}
            recipients={recipients}
            siteUrl={siteUrl}
          />

          <div className="mt-9 flex flex-col items-center gap-5">
            <ShareDayButton date={shareDate} label={dayLabel} />
            {!isSheet && (
              <Link
                href="/"
                className="inline-block text-sm font-medium text-[#cfae6f] hover:text-[#d2b577] transition-colors"
              >
                Browse the whole album →
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );

  if (isSheet) {
    return (
      <div
        className="relative paper-grain min-h-full max-w-[680px] mx-auto px-5 sm:px-6 pb-12"
        style={{ paddingTop: "max(3.5rem, calc(env(safe-area-inset-top) + 2.5rem))" }}
      >
        {inner}
      </div>
    );
  }

  return (
    <main className="relative paper-grain min-h-screen max-w-[680px] mx-auto px-5 sm:px-6 pt-14 pb-12">
      {inner}
    </main>
  );
}
