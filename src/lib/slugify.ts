/**
 * URL-safe slug from an arbitrary string. Lowercases, strips punctuation,
 * collapses whitespace/underscores to single hyphens, trims leading/trailing
 * hyphens, and caps length at 100 chars.
 *
 * Shared by the upload-complete and post-edit routes (and their tag/person
 * slugging) so both produce identical slugs.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
