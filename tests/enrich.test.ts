import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchTags, matchToVocabulary, normalizeTagKey } from "../src/lib/enrich/tags";
import { validateDateEvidence, pickDateSuggestion } from "../src/lib/enrich/date-evidence";
import { extractDatesFromText } from "../src/lib/enrich/extract-dates";
import { buildEnrichment } from "../src/lib/enrich/build";
import { hammingDistanceHex } from "../src/lib/media/image-hash";
import type { DateEvidence, RawModelEnrichment } from "../src/lib/enrich/types";

/**
 * Compose-time vision enrichment (Phase 10.1e) — the pure decision logic:
 * closed-vocabulary tag matching and the date-evidence suggestion rules.
 * Run: npx tsx --test tests/enrich.test.ts
 */

const VOCAB = [
  { name: "barbecue", slug: "barbecue" },
  { name: "Fourth of July", slug: "fourth-of-july" },
  { name: "fireworks", slug: "fireworks" },
  { name: "beach days", slug: "beach-days" },
];

describe("tag matching against the vocabulary", () => {
  it("matches exact names case-insensitively and via slugs", () => {
    assert.equal(matchToVocabulary("Barbecue", VOCAB)?.name, "barbecue");
    assert.equal(matchToVocabulary("fourth-of-july", VOCAB)?.name, "Fourth of July");
  });
  it("collapses misspellings and plural/punctuation variants", () => {
    assert.equal(matchToVocabulary("barbeque", VOCAB)?.name, "barbecue"); // 1 edit
    assert.equal(matchToVocabulary("Firework", VOCAB)?.name, "fireworks"); // plural strip
    assert.equal(matchToVocabulary("beach-day", VOCAB)?.name, "beach days");
  });
  it("does not force a match for genuinely different words", () => {
    assert.equal(matchToVocabulary("bbq", VOCAB), null); // abbreviation ≠ typo; prompt handles this
    assert.equal(matchToVocabulary("garden", VOCAB), null);
  });
  it("keeps new proposals out of the vocabulary lane and dedupes", () => {
    const r = matchTags(
      ["fireworks", "made-up-label"],
      ["Barbeque", "lake district", "Lake District", "third", "fourth-new"],
      VOCAB
    );
    // "Barbeque" proposal collapses onto the existing tag, off-list
    // "made-up-label" is dropped (the model was told to pick from the list),
    // and new proposals cap at 2 after dedup.
    assert.deepEqual(r.suggestedTags, ["fireworks", "barbecue"]);
    assert.deepEqual(r.newTagProposals, ["lake district", "third"]);
  });
  it("normalizeTagKey strips punctuation and naive plurals", () => {
    assert.equal(normalizeTagKey("Beach-Days!"), "beachday");
    assert.equal(normalizeTagKey("bus"), "bus"); // short words keep their s
  });
});

const ev = (over: Partial<DateEvidence>): DateEvidence => ({
  date: "2026-07-04",
  quotedText: "JULY 4, 2026",
  kind: "document",
  confidence: "high",
  ...over,
});

describe("date evidence validation", () => {
  it("keeps only quoted, full, plausible dates", () => {
    const out = validateDateEvidence(
      [
        { date: "2026-07-04", quoted_text: "JULY 4, 2026", kind: "document", confidence: "high" },
        { date: "1776-07-04", quoted_text: "1776", kind: "other", confidence: "high" }, // year range
        { date: "2026-07", quoted_text: "July 2026", kind: "document", confidence: "high" }, // partial
        { date: "2026-02-30", quoted_text: "Feb 30 2026", kind: "document", confidence: "high" }, // not real
        { date: "2026-07-04", quoted_text: "", kind: "document", confidence: "high" }, // no evidence
      ],
      2026
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].date, "2026-07-04");
  });
});

describe("pickDateSuggestion", () => {
  it("fills the gap when the metadata date is missing or estimated", () => {
    assert.equal(pickDateSuggestion([ev({})], null)?.date, "2026-07-04");
    const est = pickDateSuggestion([ev({})], { localDate: "2026-07-06", source: "file_mtime" });
    assert.equal(est?.date, "2026-07-04");
    assert.equal(est?.conflict, false);
  });
  it("stays silent when a trusted date agrees (within a day)", () => {
    assert.equal(
      pickDateSuggestion([ev({})], { localDate: "2026-07-04", source: "exif" }),
      null
    );
    assert.equal(
      pickDateSuggestion([ev({})], { localDate: "2026-07-05", source: "exif" }),
      null
    );
  });
  it("flags a conflict when a trusted date disagrees by more than a day", () => {
    const r = pickDateSuggestion([ev({})], { localDate: "2026-07-06", source: "exif" });
    assert.equal(r?.date, "2026-07-04");
    assert.equal(r?.conflict, true);
  });
  it("ignores low confidence and stays silent on equal-strength disagreement", () => {
    assert.equal(pickDateSuggestion([ev({ confidence: "low" })], null), null);
    assert.equal(
      pickDateSuggestion([ev({}), ev({ date: "2026-07-11" })], null),
      null // two different high-confidence document dates → ambiguous
    );
    // …but a weaker rival doesn't block the stronger evidence
    const r = pickDateSuggestion([ev({}), ev({ date: "2026-07-11", kind: "display" })], null);
    assert.equal(r?.date, "2026-07-04");
  });
});

describe("extractDatesFromText (local OCR pipeline)", () => {
  it("parses month-name and ISO forms with the match as quoted evidence", () => {
    const text = "JOIN US FOR THE 250TH\nFOURTH OF JULY\nJULY 4, 2026 6:00 PM\nThe Hoecks";
    const out = extractDatesFromText(text, 2026);
    assert.equal(out.length, 1);
    assert.equal(out[0].date, "2026-07-04");
    assert.equal(out[0].quotedText, "JULY 4, 2026");
    assert.equal(out[0].confidence, "medium"); // OCR is outranked by vision evidence

    assert.equal(extractDatesFromText("4th of July, 2026", 2026)[0]?.date, "2026-07-04");
    assert.equal(extractDatesFromText("taken 2026-07-04 evening", 2026)[0]?.date, "2026-07-04");
  });
  it("ignores ambiguous numeric forms, decorative years, and dedupes", () => {
    assert.equal(extractDatesFromText("04/07/2026", 2026).length, 0); // DMY vs MDY unknowable
    assert.equal(extractDatesFromText("est. July 4, 1776", 2026).length, 0); // year range
    assert.equal(extractDatesFromText("1776    2026", 2026).length, 0); // bare years aren't dates
    const dup = extractDatesFromText("July 4, 2026 ... 4 July 2026", 2026);
    assert.equal(dup.length, 1);
  });
});

describe("hammingDistanceHex", () => {
  it("counts differing bits and rejects malformed hashes", () => {
    assert.equal(hammingDistanceHex("0000000000000000", "0000000000000000"), 0);
    assert.equal(hammingDistanceHex("0000000000000000", "0000000000000001"), 1);
    assert.equal(hammingDistanceHex("ffffffffffffffff", "0000000000000000"), 64);
    assert.equal(hammingDistanceHex("f0f0f0f0f0f0f0f0", "0f0f0f0f0f0f0f0f"), 64);
    assert.equal(hammingDistanceHex("short", "0000000000000000"), null);
    assert.equal(hammingDistanceHex("zzzzzzzzzzzzzzzz", "0000000000000000"), null);
  });
});

describe("buildEnrichment", () => {
  it("shapes raw model output: clamps, validates, matches", () => {
    const raw: RawModelEnrichment = {
      caption: "  A backyard party with an American-flag cake.  ",
      labels: ["Party", "", "cake", "garden"],
      ocr_text: "JOIN US FOR THE 250TH FOURTH OF JULY",
      dates: [
        { date: "2026-07-04", quoted_text: "JULY 4, 2026", kind: "document", confidence: "high" },
        { date: "1776-01-01", quoted_text: "1776", kind: "other", confidence: "high" },
      ],
      applicable_tags: ["Fourth of July", "firework"],
      new_tags: ["garden party"],
    };
    const e = buildEnrichment(raw, VOCAB, "test-model", 2026);
    assert.equal(e.caption, "A backyard party with an American-flag cake.");
    assert.deepEqual(e.labels, ["party", "cake", "garden"]);
    assert.equal(e.dates.length, 1);
    assert.deepEqual(e.suggestedTags, ["Fourth of July", "fireworks"]);
    assert.deepEqual(e.newTagProposals, ["garden party"]);
    assert.equal(e.version, 1);
  });
});
