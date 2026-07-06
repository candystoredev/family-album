import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { bearerMatches } from "@/lib/safeCompare";

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET is missing or too short");
  }
  return new TextEncoder().encode(secret);
};
const COOKIE_NAME = "hoecks_session";

// Public paths that don't require auth
const PUBLIC_PATHS = [
  "/login",
  "/api/init",
  "/api/auth/login",
  // Cron-triggered daily push — authenticated in-route via CRON_SECRET.
  "/api/notifications/daily",
  "/robots.txt",
  "/share",
  // Unguessable "On this day" share links — public so link previews render and
  // recipients can open without the family login.
  "/m",
];

// Admin paths that require admin role
const ADMIN_PATHS = ["/admin", "/api/admin"];

function isPublicPath(pathname: string): boolean {
  // Individual post pages are public (for OG previews)
  if (pathname.startsWith("/posts/")) return true;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAdminPath(pathname: string): boolean {
  return ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (isPublicPath(pathname)) return NextResponse.next();

  // Check for API bearer token auth (constant-time; never matches when the
  // token env var is unset)
  if (pathname.startsWith("/api/")) {
    const auth = request.headers.get("authorization");
    if (await bearerMatches(auth, process.env.ADMIN_API_TOKEN)) {
      return NextResponse.next();
    }
  }

  // Check session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    // API routes get 401 JSON, browser routes get redirected to login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });

    // Admin routes need admin role
    if (isAdminPath(pathname) && payload.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.next();
  } catch {
    // Invalid/expired token
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(COOKIE_NAME);
    return response;
  }
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
