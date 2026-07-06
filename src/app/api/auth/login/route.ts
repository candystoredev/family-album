import { NextResponse } from "next/server";
import { createSession, verifyViewerPassword, verifyAdminPassword } from "@/lib/auth";
import { hitLoginRateLimit, clearLoginRateLimit, clientIp } from "@/lib/rateLimit";

export async function POST(request: Request) {
  const ip = clientIp(request.headers);

  try {
    // Throttle brute-force / bcrypt compute-DoS before doing any password work.
    const rl = await hitLoginRateLimit(ip);
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const { password } = await request.json();
    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }

    // Check admin password first
    if (await verifyAdminPassword(password)) {
      await createSession("admin");
      await clearLoginRateLimit(ip);
      return NextResponse.json({ ok: true, role: "admin" });
    }

    // Check viewer password
    if (await verifyViewerPassword(password)) {
      await createSession("viewer");
      await clearLoginRateLimit(ip);
      return NextResponse.json({ ok: true, role: "viewer" });
    }

    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
