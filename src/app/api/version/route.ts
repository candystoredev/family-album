import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Reports the deployed build so clients can detect when they're running a
// stale bundle (notably iOS home-screen PWAs resumed from suspension).
export async function GET() {
  return NextResponse.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
