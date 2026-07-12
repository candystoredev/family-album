import { isEstimatedDate } from "../datetime";
import type { DateEvidence } from "./types";

/**
 * Turning "the model saw a date in the image" into a safe UI suggestion.
 *
 * Guardrails (why this file exists):
 *  - only literal, quoted, full day-level dates count — no vibes, no seasons,
 *    and decorative years ("1776" on a poster) fail the range check;
 *  - the suggestion NEVER auto-applies — it renders as a tap-to-use chip that
 *    fills the manual date field;
 *  - it only speaks when it can help: the metadata date is missing/estimated,
 *    or a confidently-read document date disagrees with a trusted metadata
 *    date by more than a day. A correct EXIF date stays silent.
 *
 * Pure — tested in tests/enrich.test.ts.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1990;

const KINDS = new Set(["document", "handwriting", "display", "other"]);
const CONFIDENCES = new Set(["high", "medium", "low"]);

/** Validate raw model date output down to trustworthy DateEvidence. */
export function validateDateEvidence(
  raw: { date?: unknown; quoted_text?: unknown; kind?: unknown; confidence?: unknown }[],
  currentYear: number
): DateEvidence[] {
  const out: DateEvidence[] = [];
  for (const r of raw) {
    if (typeof r.date !== "string" || typeof r.quoted_text !== "string") continue;
    const quoted = r.quoted_text.trim();
    if (!quoted) continue; // no evidence text → not a literal read
    const m = r.date.trim().match(DATE_RE);
    if (!m) continue; // partial (year/month-only) dates can't date a post
    const [, y, mo, d] = m.map(Number) as unknown as number[];
    if (y < MIN_YEAR || y > currentYear + 1) continue;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) continue;
    const kind = KINDS.has(r.kind as string) ? (r.kind as DateEvidence["kind"]) : "other";
    const confidence = CONFIDENCES.has(r.confidence as string)
      ? (r.confidence as DateEvidence["confidence"])
      : "low";
    out.push({ date: r.date.trim(), quotedText: quoted, kind, confidence });
  }
  return out;
}

export interface DateSuggestion {
  date: string; // YYYY-MM-DD
  quotedText: string;
  /** True when it contradicts a trusted metadata date (vs filling a gap). */
  conflict: boolean;
}

const KIND_RANK: Record<DateEvidence["kind"], number> = {
  document: 0,
  handwriting: 1,
  display: 2,
  other: 3,
};
const CONF_RANK: Record<DateEvidence["confidence"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide whether (and what) to suggest, given every piece of evidence across
 * the post's media and the capture-metadata date the post would otherwise get.
 *
 * `resolved` is the post-level rollup: its capture-local day and date_source
 * (null when no media had any capture data).
 */
export function pickDateSuggestion(
  evidence: DateEvidence[],
  resolved: { localDate: string | null; source: string | null } | null
): DateSuggestion | null {
  const usable = evidence.filter((e) => e.confidence !== "low");
  if (usable.length === 0) return null;

  // Best first: document beats display, high beats medium.
  const sorted = [...usable].sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] || CONF_RANK[a.confidence] - CONF_RANK[b.confidence]
  );
  const best = sorted[0];

  // Ambiguity gate: a DIFFERENT date backed by equally-strong evidence means
  // we don't actually know — stay silent rather than guess.
  const rival = sorted.find(
    (e) =>
      e.date !== best.date &&
      KIND_RANK[e.kind] === KIND_RANK[best.kind] &&
      CONF_RANK[e.confidence] === CONF_RANK[best.confidence]
  );
  if (rival) return null;

  const localDate = resolved?.localDate ?? null;
  const trusted = !!localDate && !isEstimatedDate(resolved?.source ?? null);

  if (!trusted) {
    // Metadata date missing or itself a guess — any solid evidence helps.
    return { date: best.date, quotedText: best.quotedText, conflict: false };
  }

  // Trusted metadata date: only speak up on a real disagreement (> 1 day —
  // a party photographed just past midnight shouldn't nag).
  const diff = Math.abs(Date.parse(best.date) - Date.parse(localDate!));
  if (Number.isFinite(diff) && diff > DAY_MS) {
    return { date: best.date, quotedText: best.quotedText, conflict: true };
  }
  return null;
}
