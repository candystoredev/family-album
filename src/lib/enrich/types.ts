/**
 * Vision enrichment (Phase 10.1e, compose-time variant).
 *
 * One vision-model pass per photo, run from the browser while the user is
 * still filling in the compose form. The same payload serves every consumer:
 * the "Suggested date" affordance (dates read off invitations, banners,
 * documents), tag suggestions (matched against the existing curated
 * vocabulary), and the search-enrichment fields persisted at publish
 * (caption / labels / OCR text).
 *
 * The types here are the wire format between /api/admin/enrich and the
 * compose pages, and the shape persisted verbatim to media_metadata_raw
 * (source='vision').
 */

/** A date the model read off something IN the image, with its provenance. */
export interface DateEvidence {
  /** Full day-level date, YYYY-MM-DD. Partial dates are dropped in validation. */
  date: string;
  /** The verbatim text in the image the date was read from — required, so a
   *  suggestion can always show its evidence ("invitation reads JULY 4, 2026"). */
  quotedText: string;
  /** Where the date appeared. Documents/handwriting outrank ambient displays. */
  kind: "document" | "handwriting" | "display" | "other";
  confidence: "high" | "medium" | "low";
}

export interface MediaEnrichment {
  /** One-sentence caption for search. */
  caption: string;
  /** Free-text subject labels (search only — never shown as tags). */
  labels: string[];
  /** Text visible in the image, verbatim. Empty string when none. */
  ocrText: string;
  /** Validated day-level dates read from the image. */
  dates: DateEvidence[];
  /** Existing curated tags (exact names from the vocabulary) that apply. */
  suggestedTags: string[];
  /** Up to 2 proposed tags that matched nothing in the vocabulary. */
  newTagProposals: string[];
  /** Model that produced this, for provenance/re-runs. */
  model: string;
  version: 1;
}

/** Raw JSON the model is constrained to return (see the route's schema). */
export interface RawModelEnrichment {
  caption: string;
  labels: string[];
  ocr_text: string;
  dates: {
    date: string;
    quoted_text: string;
    kind: string;
    confidence: string;
  }[];
  applicable_tags: string[];
  new_tags: string[];
}

/** Loose runtime guard for enrichment payloads arriving from the client at
 *  publish time — enough to persist safely, not a full validation. */
export function isMediaEnrichment(v: unknown): v is MediaEnrichment {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.caption === "string" &&
    Array.isArray(e.labels) &&
    Array.isArray(e.dates) &&
    e.version === 1
  );
}
