import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const getSecret = () => new TextEncoder().encode(process.env.JWT_SECRET!);
const COOKIE_NAME = "hoecks_session";

// Public paths that don't require auth
const PUBLIC_PATHS = [
  "/login",
  "/api/init",
  "/api/auth/login",
  "/robots.txt",
];

// Admin paths that require admin role
const ADMIN_PATHS = ["/admin", "/api/admin"];

// API paths that accept bearer token auth
const API_PATHS = ["/api/"];

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

  // Check for API bearer token auth
  if (pathname.startsWith("/api/")) {
    const auth = request.headers.get("authorization");
    if (auth?.startsWith("Bearer ") && auth.slice(7) === process.env.ADMIN_API_TOKEN) {
      return NextResponse.next();
    }
  }

  // Check session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());

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
