import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMemoriesForDate } from "@/lib/onThisDay";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ posts: [] }, { status: 401 });

  const month = req.nextUrl.searchParams.get("month");
  const day = req.nextUrl.searchParams.get("day");

  if (!month || !day) return NextResponse.json({ posts: [] });

  const posts = await getMemoriesForDate(Number(month), Number(day));
  return NextResponse.json({ posts });
}
