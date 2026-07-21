import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ftsRowFor } from "../src/lib/schema";

/**
 * Phase 12c — incremental FTS writes must index the post's real body, not ''.
 * `ftsRowFor` is the shared row-builder used by both incremental insert
 * sites (post create, post edit) and must match rebuildFtsIndex()'s SQL
 * semantics: COALESCE(title/body, ''), tag/people names space-joined.
 */

describe("ftsRowFor", () => {
  it("includes the post's body instead of blanking it out", () => {
    const row = ftsRowFor({
      title: "Hike day",
      body: "The kids were up at 5am. Worth it.",
      tagNames: ["outdoors"],
      peopleNames: ["Mom"],
    });
    assert.equal(row.body, "The kids were up at 5am. Worth it.");
  });

  it("COALESCEs a null/undefined body to '', matching rebuildFtsIndex", () => {
    assert.equal(ftsRowFor({ title: "t", body: null, tagNames: [], peopleNames: [] }).body, "");
    assert.equal(ftsRowFor({ title: "t", body: undefined, tagNames: [], peopleNames: [] }).body, "");
  });

  it("COALESCEs a null/undefined title to ''", () => {
    assert.equal(ftsRowFor({ title: null, body: "b", tagNames: [], peopleNames: [] }).title, "");
    assert.equal(ftsRowFor({ title: undefined, body: "b", tagNames: [], peopleNames: [] }).title, "");
  });

  it("space-joins tag and people names, dropping blanks (like GROUP_CONCAT(name, ' '))", () => {
    const row = ftsRowFor({
      title: "t",
      body: "b",
      tagNames: ["beach", "", "  ", "summer"],
      peopleNames: ["Alice", "Bob"],
    });
    assert.equal(row.tags, "beach summer");
    assert.equal(row.people, "Alice Bob");
  });

  it("produces '' for tags/people when there are none, matching COALESCE(..., '')", () => {
    const row = ftsRowFor({ title: "t", body: "b", tagNames: [], peopleNames: [] });
    assert.equal(row.tags, "");
    assert.equal(row.people, "");
  });

  it("space-joins place labels, deduping repeats (a whole vacation → one town)", () => {
    const row = ftsRowFor({
      title: "t",
      body: "b",
      tagNames: [],
      peopleNames: [],
      placeNames: [
        "Truro, Cornwall, England, United Kingdom",
        "Truro, Cornwall, England, United Kingdom",
        "St Ives, Cornwall, England, United Kingdom",
      ],
    });
    assert.equal(
      row.place,
      "Truro, Cornwall, England, United Kingdom St Ives, Cornwall, England, United Kingdom"
    );
  });

  it("space-joins captions and drops blanks", () => {
    const row = ftsRowFor({
      title: "t",
      body: "b",
      tagNames: [],
      peopleNames: [],
      captions: ["A dog on the beach", "  ", "Sunset over the cliffs"],
    });
    assert.equal(row.captions, "A dog on the beach Sunset over the cliffs");
  });

  it("defaults place/captions to '' when absent, matching COALESCE(..., '')", () => {
    const row = ftsRowFor({ title: "t", body: "b", tagNames: [], peopleNames: [] });
    assert.equal(row.place, "");
    assert.equal(row.captions, "");
  });
});
