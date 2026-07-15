import TodayContent from "./TodayContent";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "On This Day · The Hoecks",
};

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  return <TodayContent dateParam={date} variant="page" />;
}
