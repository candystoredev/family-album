/**
 * Derive the site's base URL (origin) from an incoming request, so generated
 * links (e.g. share URLs) always match the domain the user is actually on —
 * rather than depending on NEXT_PUBLIC_SITE_URL being kept in sync.
 *
 * Falls back to NEXT_PUBLIC_SITE_URL, then the prod domain, when no host header
 * is present (e.g. non-HTTP invocation).
 */
export function baseUrlFromRequest(request: Request): string {
  // On Vercel the public host arrives as x-forwarded-host; `host` is the
  // fallback for local/dev.
  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") || "https";
    return `${proto}://${host}`;
  }
  return process.env.NEXT_PUBLIC_SITE_URL || "https://thehoecks.com";
}
