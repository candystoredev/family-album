import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";

// The helpers under test read JWT_SECRET / ADMIN_API_TOKEN / ADMIN_PASSWORD
// from process.env lazily, inside function bodies (see getSecret() in both
// src/middleware.ts and src/lib/auth.ts) — not at import time — so it's safe
// to set them here, before any test body runs, without a .env file. 32+ chars
// on JWT_SECRET matches the app's own fail-closed check.
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-characters-long";
process.env.ADMIN_API_TOKEN = "test-admin-api-token";
process.env.ADMIN_PASSWORD = "test-admin-password";

import { middleware } from "../src/middleware";
import { verifyAdminPassword, verifyApiToken } from "../src/lib/auth";
import { safeEqual, bearerMatches } from "../src/lib/safeCompare";

/**
 * Phase 11b — auth/middleware hardening tests.
 *
 * This app enforces ALL auth in src/middleware.ts: a public-path allowlist,
 * a session cookie verified as a JWT via jose, admin-role gating on top of
 * that, and a separate ADMIN_API_TOKEN bearer path for /api/*. It was
 * previously untested — this file is the first coverage of that logic.
 *
 * Approach: rather than build elaborate NextRequest/NextResponse mocks
 * (which would mostly test the mock, not the code), these tests invoke the
 * REAL exported `middleware()` function from src/middleware.ts with real
 * `next/server` NextRequest objects and real jose-signed tokens. This works
 * because NextRequest/NextResponse are plain Web-API-based classes — no Edge
 * runtime or dev server needed to construct and call them directly in a
 * plain `tsx --test` process (verified empirically while writing this file).
 * So "public path matching" and "admin path matching" below are exercised
 * as black-box behavior of the real middleware, not by reaching into its
 * unexported isPublicPath/isAdminPath helpers.
 *
 * Known, honest gap: `getSession()` / `createSession()` in src/lib/auth.ts
 * call `cookies()` from `next/headers`, which requires Next's request-scoped
 * AsyncLocalStorage context. Calling either from a plain node:test process
 * throws "`cookies` was called outside a request scope" (confirmed directly
 * while writing this file) — there is no meaningful way to unit-test them
 * here. Their JWT verification is the same pattern exercised below via
 * middleware() (same COOKIE_NAME "hoecks_session", same getSecret(), same
 * `jwtVerify(token, secret, { algorithms: ["HS256"] })`), so the
 * security-relevant logic is covered, just not through that exact function.
 * A real check of getSession()/createSession() would need an integration
 * test against a running `next dev`/`next start` server (e.g. hitting a
 * route that calls them and reading back Set-Cookie) — that is a follow-up,
 * not attempted here.
 *
 * Run: npx tsx --test tests/auth-middleware.test.ts
 */

function secretBytes(s: string) {
  return new TextEncoder().encode(s);
}

async function signToken(
  role: string,
  opts: { secret?: string; expiresIn?: string } = {}
): Promise<string> {
  const { secret = process.env.JWT_SECRET!, expiresIn = "90d" } = opts;
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretBytes(secret));
}

function reqFor(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`, { headers }));
}

function reqWithCookie(path: string, token: string, headers: Record<string, string> = {}): NextRequest {
  return reqFor(path, { ...headers, cookie: `hoecks_session=${token}` });
}

// Public paths call NextResponse.next(), which stamps this header — the
// cleanest black-box signal that the request passed straight through.
function passedThrough(res: Response): boolean {
  return res.headers.get("x-middleware-next") === "1";
}

describe("middleware — public path matching", () => {
  // Mirrors PUBLIC_PATHS + the /posts/ special case in src/middleware.ts.
  // If that list changes, update this alongside it.
  const publicPaths = [
    "/login",
    "/api/init",
    "/api/auth/login",
    "/api/notifications/daily",
    "/robots.txt",
    "/share",
    "/share/abc123token",
    "/m",
    "/m/abc123token",
    "/posts/some-post-slug",
  ];

  for (const path of publicPaths) {
    it(`${path} is public (no auth required)`, async () => {
      const res = await middleware(reqFor(path));
      assert.ok(passedThrough(res), `expected ${path} to pass through, got status ${res.status}`);
    });
  }

  const protectedPaths = ["/", "/settings", "/api/feed"];
  for (const path of protectedPaths) {
    it(`${path} is NOT public (requires auth)`, async () => {
      const res = await middleware(reqFor(path));
      assert.ok(!passedThrough(res), `expected ${path} to require auth`);
    });
  }

  it("no-cookie browser route redirects to /login", async () => {
    const res = await middleware(reqFor("/settings"));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), "http://localhost/login");
  });

  it("no-cookie API route returns 401 JSON, not a redirect", async () => {
    const res = await middleware(reqFor("/api/feed"));
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
  });
});

describe("middleware — JWT/session verification", () => {
  it("token signed with the right secret verifies and passes", async () => {
    const token = await signToken("viewer");
    const res = await middleware(reqWithCookie("/settings", token));
    assert.ok(passedThrough(res));
  });

  it("wrong-secret token is rejected: redirected to /login, cookie cleared", async () => {
    const token = await signToken("admin", { secret: "a-completely-different-signing-secret!!" });
    const res = await middleware(reqWithCookie("/settings", token));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), "http://localhost/login");
    assert.equal(res.cookies.get("hoecks_session")?.value, "");
  });

  it("tampered token (signature byte flipped) is rejected", async () => {
    const token = await signToken("admin");
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    const res = await middleware(reqWithCookie("/settings", flipped));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), "http://localhost/login");
  });

  it("expired token is rejected", async () => {
    const token = await signToken("admin", { expiresIn: "-10s" });
    const res = await middleware(reqWithCookie("/settings", token));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), "http://localhost/login");
  });

  it("missing token on an API route is rejected with 401 (not a redirect)", async () => {
    const res = await middleware(reqFor("/api/feed"));
    assert.equal(res.status, 401);
  });

  it("missing token on a browser route is rejected with a redirect", async () => {
    const res = await middleware(reqFor("/settings"));
    assert.equal(res.status, 307);
  });
});

describe("middleware — admin role gating", () => {
  it("admin-role token passes an /admin route", async () => {
    const token = await signToken("admin");
    const res = await middleware(reqWithCookie("/admin", token));
    assert.ok(passedThrough(res));
  });

  it("admin-role token passes an /api/admin/* route", async () => {
    const token = await signToken("admin");
    const res = await middleware(reqWithCookie("/api/admin/settings", token));
    assert.ok(passedThrough(res));
  });

  it("viewer-role token is forbidden on an /admin route (403, not a redirect)", async () => {
    const token = await signToken("viewer");
    const res = await middleware(reqWithCookie("/admin", token));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Forbidden" });
  });

  it("viewer-role token is forbidden on an /api/admin/* route", async () => {
    const token = await signToken("viewer");
    const res = await middleware(reqWithCookie("/api/admin/settings", token));
    assert.equal(res.status, 403);
  });

  it("viewer-role token still passes a non-admin protected route", async () => {
    const token = await signToken("viewer");
    const res = await middleware(reqWithCookie("/settings", token));
    assert.ok(passedThrough(res));
  });
});

describe("middleware — ADMIN_API_TOKEN bearer path", () => {
  it("matching bearer token authorizes an /api/* request with no session cookie", async () => {
    const res = await middleware(
      reqFor("/api/feed", { authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` })
    );
    assert.ok(passedThrough(res));
  });

  it("non-matching bearer token does not authorize (falls through to 401)", async () => {
    const res = await middleware(reqFor("/api/feed", { authorization: "Bearer wrong-token" }));
    assert.equal(res.status, 401);
  });

  it("fails closed when ADMIN_API_TOKEN is unset, even for a literal 'Bearer undefined'", async () => {
    const saved = process.env.ADMIN_API_TOKEN;
    delete process.env.ADMIN_API_TOKEN;
    try {
      const res = await middleware(reqFor("/api/feed", { authorization: "Bearer undefined" }));
      assert.equal(res.status, 401);
    } finally {
      process.env.ADMIN_API_TOKEN = saved;
    }
  });

  it("bearer check only applies to /api/*: a matching bearer on a page route is ignored", async () => {
    const res = await middleware(
      reqFor("/settings", { authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` })
    );
    // No cookie present, and the bearer path is skipped for non-/api routes,
    // so this must fall through to the cookie check and redirect.
    assert.ok(!passedThrough(res));
    assert.equal(res.status, 307);
  });
});

describe("safeCompare — constant-time helpers backing auth", () => {
  it("safeEqual matches identical strings", async () => {
    assert.equal(await safeEqual("secret-value", "secret-value"), true);
  });

  it("safeEqual rejects differing strings, including differing lengths", async () => {
    assert.equal(await safeEqual("secret-value", "not-the-secret"), false);
    assert.equal(await safeEqual("short", "a-much-longer-value"), false);
  });

  it("safeEqual fails closed when either side is missing (no fail-open on undefined)", async () => {
    assert.equal(await safeEqual(undefined, "anything"), false);
    assert.equal(await safeEqual("anything", undefined), false);
    assert.equal(await safeEqual(null, null), false);
  });

  it("bearerMatches requires a well-formed 'Bearer <token>' header", async () => {
    assert.equal(await bearerMatches("Bearer abc", "abc"), true);
    assert.equal(await bearerMatches("abc", "abc"), false); // missing "Bearer " prefix
    assert.equal(await bearerMatches(null, "abc"), false);
    assert.equal(await bearerMatches("Bearer abc", undefined), false);
  });
});

describe("src/lib/auth.ts — password & API token verification", () => {
  it("verifyAdminPassword accepts the configured ADMIN_PASSWORD", async () => {
    assert.equal(await verifyAdminPassword(process.env.ADMIN_PASSWORD!), true);
  });

  it("verifyAdminPassword rejects a wrong password", async () => {
    assert.equal(await verifyAdminPassword("definitely-wrong"), false);
  });

  it("verifyAdminPassword fails closed when ADMIN_PASSWORD is unset", async () => {
    const saved = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    try {
      assert.equal(await verifyAdminPassword("anything"), false);
    } finally {
      process.env.ADMIN_PASSWORD = saved;
    }
  });

  it("verifyApiToken accepts a matching bearer token", async () => {
    const req = new Request("http://localhost/api/x", {
      headers: { authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` },
    });
    assert.equal(await verifyApiToken(req), true);
  });

  it("verifyApiToken rejects a non-matching bearer token", async () => {
    const req = new Request("http://localhost/api/x", { headers: { authorization: "Bearer wrong" } });
    assert.equal(await verifyApiToken(req), false);
  });

  it("verifyApiToken rejects a missing Authorization header", async () => {
    const req = new Request("http://localhost/api/x");
    assert.equal(await verifyApiToken(req), false);
  });
});
