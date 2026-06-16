import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensurePushSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let endpoint: string | undefined;
  try {
    ({ endpoint } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

  await ensurePushSchema();
  await db.execute({
    sql: "DELETE FROM push_subscriptions WHERE endpoint = ?",
    args: [endpoint],
  });

  return NextResponse.json({ ok: true });
}
