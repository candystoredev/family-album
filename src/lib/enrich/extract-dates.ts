import { validateDateEvidence } from "./date-evidence";
import type { DateEvidence } from "./types";

/**
 * Model-free date extraction: turn OCR'd text into DateEvidence for the same
 * suggestion pipeline the vision pass feeds. Only unambiguous written forms
 * are parsed — month-name dates and ISO dates. Pure-numeric forms like
 * 04/07/2026 are deliberately ignored (US vs UK day/month order can't be
 * resolved from pixels). Pure — tested in tests/enrich.test.ts.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun[e]?|jul[y]?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

// "JULY 4, 2026" / "July 4th 2026" / "Sept. 4, 2026"
const MDY_RE = new RegExp(
  `\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s+((?:19|20)\\d{2})\\b`,
  "gi"
);
// "4 July 2026" / "4th of July, 2026"
const DMY_RE = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?\\s*,?\\s+((?:19|20)\\d{2})\\b`,
  "gi"
);
// "2026-07-04"
const ISO_RE = /\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/g;

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Extract day-level dates written out in `text`. Every hit carries the exact
 * matched substring as its quoted evidence; the shared validator applies the
 * same guards as vision evidence (real calendar date, sane year range — so a
 * decorative "1776" still can't date a post). OCR can't judge context, so
 * everything comes back kind "other" / confidence "medium": it participates
 * in suggestions but is outranked by vision-verified document evidence.
 */
export function extractDatesFromText(text: string, currentYear: number): DateEvidence[] {
  if (!text.trim()) return [];
  const raw: { date: string; quoted_text: string; kind: string; confidence: string }[] = [];
  const push = (y: number, mo: number, d: number, quoted: string) =>
    raw.push({
      date: `${y}-${pad2(mo)}-${pad2(d)}`,
      quoted_text: quoted.replace(/\s+/g, " ").trim(),
      kind: "other",
      confidence: "medium",
    });

  for (const m of text.matchAll(MDY_RE)) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (month) push(Number(m[3]), month, Number(m[2]), m[0]);
  }
  for (const m of text.matchAll(DMY_RE)) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month) push(Number(m[3]), month, Number(m[1]), m[0]);
  }
  for (const m of text.matchAll(ISO_RE)) {
    push(Number(m[1]), Number(m[2]), Number(m[3]), m[0]);
  }

  const validated = validateDateEvidence(raw, currentYear);
  // Dedupe by date (first quoted occurrence wins).
  const seen = new Set<string>();
  return validated.filter((e) => (seen.has(e.date) ? false : (seen.add(e.date), true)));
}
