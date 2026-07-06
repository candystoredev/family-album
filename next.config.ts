import type { NextConfig } from "next";

// Content-Security-Policy. Notes:
// - Images/video come from the public R2 bucket (*.r2.dev); presigned uploads
//   PUT to *.r2.cloudflarestorage.com — both must be allowed.
// - 'unsafe-inline' is still needed for Next's inline bootstrap and the app's
//   inline styles; tightening script-src to a nonce is a planned follow-up.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
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
