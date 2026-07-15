import MemorySheet from "@/components/MemorySheet";

// The sheet lives in the segment LAYOUT, not the page: navigation then commits
// as soon as the (static) shell is ready and the curtain starts sliding over
// loading.tsx immediately, while the DB-backed page streams in. The loading →
// page swap happens inside the already-animating sheet instead of restarting
// it. With the sheet in the page, the tap showed nothing until the whole RSC
// payload arrived — which read as a dead tap on the phone.
export default function InterceptedTodayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MemorySheet>{children}</MemorySheet>;
}
