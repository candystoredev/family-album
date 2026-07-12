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
