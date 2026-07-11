import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendPushToEndpoint } from "@/lib/push";

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

  try {
    await sendPushToEndpoint(endpoint, {
      title: "The Hoecks",
      body: "Notifications are working! You'll get a daily memory each morning.",
      url: "/today",
      icon: "/icon-192.png",
      tag: "test",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Test push failed:", err);
    return NextResponse.json(
      { error: "Failed to send test notification" },
      { status: 500 }
    );
  }
}
