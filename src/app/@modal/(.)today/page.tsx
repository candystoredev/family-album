import MemorySheet from "@/components/MemorySheet";
import TodayContent from "@/app/today/TodayContent";

// Intercepts a soft nav to /today (teaser card, sidebar link) and renders it as
// a slide-down sheet over the feed. Hard loads of /today are NOT intercepted —
// they render the full page (see today/page.tsx). No metadata export here: the
// URL is /today, whose real page.tsx owns the document title.
export const dynamic = "force-dynamic";

export default async function InterceptedToday({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  return (
    <MemorySheet>
      <TodayContent dateParam={date} variant="sheet" />
    </MemorySheet>
  );
}
