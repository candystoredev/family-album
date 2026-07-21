import { slugify } from "../slugify";

/**
 * Closed-vocabulary tag matching for vision enrichment.
 *
 * The model is prompted to pick tags FROM the existing vocabulary, so its
 * output should already be exact names. This module is the safety net for
 * near-misses ("Barbeque" → "barbecue") and the gate that keeps genuinely new
 * proposals from duplicating existing tags under a different spelling. Pure —
 * tested in tests/enrich.test.ts.
 */

/** Aggressive normalization for fuzzy comparison: lowercase, alphanumeric
 *  only, naive singular (trailing 's' stripped for words ≥ 4 chars). */
export function normalizeTagKey(name: string): string {
  let key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (key.length >= 4 && key.endsWith("s")) key = key.slice(0, -1);
  return key;
}

/** Levenshtein edit distance — small inputs only (tag names). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[n];
}

export interface VocabTag {
  name: string;
  slug: string;
}

/** Find the existing tag a model-emitted candidate refers to, or null.
 *  Tries exact name → slug → normalized key → edit distance 1 (typo net). */
export function matchToVocabulary(candidate: string, vocab: VocabTag[]): VocabTag | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const slug = slugify(trimmed);
  const key = normalizeTagKey(trimmed);

  for (const t of vocab) if (t.name.toLowerCase() === lower) return t;
  for (const t of vocab) if (t.slug === slug) return t;
  if (key.length >= 3) {
    for (const t of vocab) if (normalizeTagKey(t.name) === key) return t;
  }
  // Typo net: one edit on the normalized keys, only for words long enough
  // that a single edit can't turn one real tag into a different one.
  if (key.length >= 5) {
    for (const t of vocab) {
      const tk = normalizeTagKey(t.name);
      if (tk.length >= 5 && editDistance(key, tk) === 1) return t;
    }
  }
  return null;
}

export interface TagMatchResult {
  /** Existing vocabulary names (exact spelling) to suggest. */
  suggestedTags: string[];
  /** Cleaned proposals that matched nothing — rendered as "new tag" chips. */
  newTagProposals: string[];
}

const MAX_NEW_PROPOSALS = 2;
const MAX_TAG_LENGTH = 30;

/**
 * Resolve the model's tag output against the curated vocabulary. Anything —
 * including a "new" proposal — that fuzzily matches an existing tag collapses
 * onto that tag's canonical name, so the vocabulary can't grow near-duplicates
 * ("bbq" while "barbecue" exists is prevented at the prompt level; "barbeque"
 * is caught here).
 */
export function matchTags(
  applicable: string[],
  proposals: string[],
  vocab: VocabTag[]
): TagMatchResult {
  const suggested: string[] = [];
  const seen = new Set<string>();
  const addSuggested = (t: VocabTag) => {
    if (!seen.has(t.slug)) {
      seen.add(t.slug);
      suggested.push(t.name);
    }
  };

  for (const c of applicable) {
    const match = matchToVocabulary(c, vocab);
    if (match) addSuggested(match);
    // An off-list "applicable" tag with no match is dropped — the model was
    // told to choose from the list, so an unmatched entry is noise, not a
    // proposal.
  }

  const newTags: string[] = [];
  const newKeys = new Set<string>();
  for (const p of proposals) {
    const match = matchToVocabulary(p, vocab);
    if (match) {
      addSuggested(match);
      continue;
    }
    const cleaned = p.trim().toLowerCase();
    const key = normalizeTagKey(cleaned);
    if (!cleaned || cleaned.length > MAX_TAG_LENGTH || !key) continue;
    if (newKeys.has(key)) continue;
    newKeys.add(key);
    if (newTags.length < MAX_NEW_PROPOSALS) newTags.push(cleaned);
  }

  return { suggestedTags: suggested, newTagProposals: newTags };
}

/**
 * Title-contains suggestions (Part 2, Workstream B). When the typed post title
 * mentions an existing tag's name as a whole word, suggest that tag. Pure and
 * closed-vocabulary: only names from `tagNames` are ever returned (in their
 * canonical spelling), so this can never propose a new tag.
 *
 * Matching is case-insensitive and whole-word — multi-word tag names are
 * supported ("beach days") and word boundaries mean "art" doesn't fire on
 * "party". Tags shorter than 3 chars are ignored (too noisy to match as words).
 */
export function suggestTagsFromTitle(title: string, tagNames: string[]): string[] {
  const hay = title.trim().toLowerCase();
  if (!hay) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of tagNames) {
    const n = name.trim();
    if (n.length < 3) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    if (wholeWordContains(hay, key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/** Whole-word containment of `needleLower` in `haystackLower` (both already
 *  lowercased). Boundaries are non-alphanumeric or string ends, so interior
 *  spaces of a multi-word needle are literal and "art" ∉ "party". */
function wholeWordContains(haystackLower: string, needleLower: string): boolean {
  const escaped = needleLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(haystackLower);
}

/** Reverse-geocoded place components, most- to least-specific. */
export interface PlaceComponents {
  name?: string | null;
  admin2?: string | null;
  admin1?: string | null;
}

/**
 * Partition a photo's place components (Part 2, Workstream B) into existing-tag
 * suggestions and new-tag proposals. Every component is matched against the
 * vocabulary, so an already-existing tag ("England") is suggested no matter how
 * broad. Of the UNMATCHED components only `name` (a town) and `admin2` (its
 * county) are offered as proposals — `admin1`/country are too broad to propose.
 * A name never appears in both arrays; both are deduped. Pure (DB-free).
 */
export function partitionPlaceComponents(
  components: PlaceComponents,
  vocab: VocabTag[]
): { tags: string[]; newTagProposals: string[] } {
  const tags: string[] = [];
  const tagSlugs = new Set<string>();
  const proposals: string[] = [];
  const proposalKeys = new Set<string>();

  const entries: Array<{ value: string | null | undefined; proposable: boolean }> = [
    { value: components.name, proposable: true },
    { value: components.admin2, proposable: true },
    { value: components.admin1, proposable: false }, // match only, never propose
  ];

  for (const { value, proposable } of entries) {
    const v = value?.trim();
    if (!v) continue;
    const match = matchToVocabulary(v, vocab);
    if (match) {
      if (!tagSlugs.has(match.slug)) {
        tagSlugs.add(match.slug);
        tags.push(match.name);
      }
      continue;
    }
    if (!proposable) continue;
    const key = normalizeTagKey(v);
    if (!key || v.length > MAX_TAG_LENGTH) continue;
    if (proposalKeys.has(key)) continue;
    proposalKeys.add(key);
    // Place names are proper nouns — keep the geocoder's canonical casing
    // rather than lowercasing (unlike model-emitted proposals).
    proposals.push(v);
  }

  return { tags, newTagProposals: proposals };
}
