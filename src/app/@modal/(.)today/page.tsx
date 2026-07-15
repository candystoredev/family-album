import TodayContent from "@/app/today/TodayContent";

// Intercepts a soft nav to /today (teaser, sidebar link) and renders it as a
// slide-down sheet over the feed — the MemorySheet wrapper lives in this
// segment's layout.tsx so the slide starts on loading.tsx before this resolves.
// Hard loads of /today are NOT intercepted — they render the full page (see
// today/page.tsx). No metadata export here: the URL is /today, whose real
// page.tsx owns the document title.
export const dynamic = "force-dynamic";

export default async function InterceptedToday({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  return <TodayContent dateParam={date} variant="sheet" />;
}
