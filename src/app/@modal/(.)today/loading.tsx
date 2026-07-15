// Skeleton shown inside the sliding sheet while TodayContent streams in.
// Wrapper classes mirror TodayContent's sheet variant so the loading → page
// swap doesn't shift layout.
export default function InterceptedTodayLoading() {
  return (
    <div
      className="relative paper-grain min-h-full max-w-[680px] mx-auto px-5 sm:px-6 pb-12"
      style={{ paddingTop: "max(3.5rem, calc(env(safe-area-inset-top) + 2.5rem))" }}
    >
      <header className="mb-7 text-center">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#8a774d] mb-2">
          On this day
        </p>
        <div className="mx-auto h-9 w-40 rounded-md bg-[#211e1a] animate-pulse" />
      </header>

      <div className="space-y-6">
        <div className="h-80 rounded-[18px] bg-[#211e1a] border border-[#2b2722] animate-pulse" />
        <div className="h-80 rounded-[18px] bg-[#211e1a] border border-[#2b2722] animate-pulse" />
      </div>
    </div>
  );
}
