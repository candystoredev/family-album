/**
 * Phase 10.2 — effective ordering/grouping keys for the feed, computed at read
 * time so we never mutate the legacy `posts.date`.
 *
 * ORDER_KEY: the precise capture instant (`taken_at`) when known, else the
 * legacy `posts.date` normalized to the same canonical UTC ISO form
 * (`YYYY-MM-DDTHH:MM:SS.mmmZ`). The two legacy formats — migrated posts
 * (`…T…Z`, from toISOString) and older uploads (`… …`, space, no Z) — and
 * `taken_at` all collapse to one comparable string, so captured posts sort by
 * their true instant while everything else keeps its current order.
 *
 * EFF_DAY: the capture-local calendar day (`local_date`) when known, else the
 * day portion of the legacy date. Used for month ranges + grouping.
 *
 * Both reference the posts table as alias `p`.
 */
export const ORDER_KEY_SQL =
  "COALESCE(p.taken_at, replace(rtrim(p.date,'Z'),' ','T')||'Z')";

export const EFF_DAY_SQL = "COALESCE(p.local_date, substr(p.date,1,10))";
