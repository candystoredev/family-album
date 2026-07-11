/**
 * Phase 11e — share-link revocation. A single pure predicate shared by both
 * public share routes (/share/[token] for posts, /m/[token] for "on this day")
 * so "is this link still usable" stays consistent and testable in one place.
 *
 * Revocation has no expiry semantics of its own — day links have no expires_at
 * column at all (pass `expires_at: undefined`), and post links keep their
 * existing persistent-by-default expiry behavior.
 */
export function isShareLinkUsable(
  link: { revoked?: number | boolean | null; expires_at?: string | null },
  nowMs: number
): boolean {
  if (link.revoked) return false;
  if (link.expires_at && new Date(link.expires_at).getTime() < nowMs) return false;
  return true;
}
