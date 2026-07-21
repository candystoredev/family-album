import type { NextConfig } from "next";

// Content-Security-Policy. Notes:
// - Images/video come from the public R2 bucket (*.r2.dev); presigned uploads
//   PUT to *.r2.cloudflarestorage.com — both must be allowed.
// - 'unsafe-inline' is still needed for Next's inline bootstrap and the app's
//   inline styles; tightening script-src to a nonce is a planned follow-up.
const csp = [
  "default-src 'self'",
  // Dev only: webpack's dev runtime (HMR, eval-source-map) executes modules
  // via eval(), which CSP blocks without 'unsafe-eval' — hydration dies
  // silently and `next dev` serves a static page. Never sent in production.
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.r2.dev",
  "media-src 'self' blob: https://*.r2.dev",
  "font-src 'self' data:",
  "connect-src 'self' https://*.r2.dev https://*.r2.cloudflarestorage.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  // The offline reverse-geocode dataset is read at runtime with fs.readFileSync
  // (src/lib/geo/reverse.ts). Next's file tracer can't see that dynamic path,
  // so name it explicitly for the routes that geocode, ensuring it's bundled
  // into their Vercel serverless functions rather than 404'ing at runtime.
  outputFileTracingIncludes: {
    "/api/admin/upload/complete": ["./src/lib/geo/data/places.json.gz"],
    "/api/admin/posts/[postId]": ["./src/lib/geo/data/places.json.gz"],
    "/api/admin/suggest-tags": ["./src/lib/geo/data/places.json.gz"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
