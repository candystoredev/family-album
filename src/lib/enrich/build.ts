import { matchTags, type VocabTag } from "./tags";
import { validateDateEvidence } from "./date-evidence";
import type { MediaEnrichment, RawModelEnrichment } from "./types";

const MAX_LABELS = 10;
const MAX_CAPTION = 300;
const MAX_OCR = 2000;

/**
 * Shape the model's raw structured output into the MediaEnrichment wire
 * format: clamp free-text fields, validate date evidence, and resolve tag
 * candidates against the curated vocabulary. Pure — the API route is a thin
 * shell around this; tested in tests/enrich.test.ts.
 */
export function buildEnrichment(
  raw: RawModelEnrichment,
  vocab: VocabTag[],
  model: string,
  currentYear: number
): MediaEnrichment {
  const labels = (Array.isArray(raw.labels) ? raw.labels : [])
    .filter((l): l is string => typeof l === "string" && !!l.trim())
    .map((l) => l.trim().toLowerCase())
    .slice(0, MAX_LABELS);

  const { suggestedTags, newTagProposals } = matchTags(
    Array.isArray(raw.applicable_tags) ? raw.applicable_tags.filter((t) => typeof t === "string") : [],
    Array.isArray(raw.new_tags) ? raw.new_tags.filter((t) => typeof t === "string") : [],
    vocab
  );

  return {
    caption: typeof raw.caption === "string" ? raw.caption.trim().slice(0, MAX_CAPTION) : "",
    labels,
    ocrText: typeof raw.ocr_text === "string" ? raw.ocr_text.trim().slice(0, MAX_OCR) : "",
    dates: validateDateEvidence(Array.isArray(raw.dates) ? raw.dates : [], currentYear),
    suggestedTags,
    newTagProposals,
    model,
    version: 1,
  };
}
