/**
 * Constant-time string comparison that works in both the Edge runtime
 * (middleware) and the Node runtime (route handlers) via Web Crypto.
 *
 * Both inputs are hashed to a fixed 32-byte digest before comparison, so the
 * compare is length-independent (no length oracle) and runs in constant time.
 * Returns false when either value is missing — so an unset secret can never
 * "match" (no fail-open on `=== undefined`).
 */
export async function safeEqual(
  a: string | undefined | null,
  b: string | undefined | null
): Promise<boolean> {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/** Match an `Authorization: Bearer <token>` header against a secret, safely. */
export async function bearerMatches(
  authHeader: string | null | undefined,
  secret: string | undefined | null
): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;
  return safeEqual(authHeader.slice(7), secret);
}
