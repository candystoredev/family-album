import { NextResponse } from "next/server";
import { createSession, verifyViewerPassword, verifyAdminPassword } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }

    // Check admin password first
    if (await verifyAdminPassword(password)) {
      await createSession("admin");
      return NextResponse.json({ ok: true, role: "admin" });
    }

    // Check viewer password
    if (await verifyViewerPassword(password)) {
      await createSession("viewer");
      return NextResponse.json({ ok: true, role: "viewer" });
    }

    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
