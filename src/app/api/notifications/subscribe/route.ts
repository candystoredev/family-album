import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensurePushSchema } from "@/lib/schema";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";

interface SubscribeBody {
  subscription?: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  label?: string;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: SubscribeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sub = body.subscription;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const label = (body.label || "").slice(0, 100) || null;

  await ensurePushSchema();

  // Upsert on endpoint so re-subscribing the same device refreshes its keys
  // instead of creating duplicates.
  await db.execute({
    sql: `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, label)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            label = COALESCE(excluded.label, push_subscriptions.label)`,
    args: [nanoid(), endpoint, p256dh, auth, label],
  });

  return NextResponse.json({ ok: true });
}
