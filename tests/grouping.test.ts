import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupByGap, GAP_THRESHOLDS } from "../src/lib/media/grouping";

/**
 * Timestamp-gap grouping tests (Phase 9a).
 * Run: npx tsx --test tests/grouping.test.ts
 */

const HOUR = 60 * 60 * 1000;

function item(iso: string, name = "") {
  return { date: new Date(iso), name };
}

describe("groupByGap", () => {
  it("returns empty for no items", () => {
    assert.deepEqual(groupByGap([], HOUR), []);
  });

  it("single item → single group", () => {
    const groups = groupByGap([item("2019-07-04T10:00:00Z")], HOUR);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].length, 1);
  });

  it("splits at gaps greater than the threshold", () => {
    const groups = groupByGap(
      [
        item("2019-07-04T10:00:00Z"),
        item("2019-07-04T10:30:00Z"),
        item("2019-07-04T12:00:00Z"), // 90min gap → new group
        item("2019-07-04T12:10:00Z"),
      ],
      HOUR
    );
    assert.equal(groups.length, 2);
    assert.equal(groups[0].length, 2);
    assert.equal(groups[1].length, 2);
  });

  it("a gap of exactly the threshold does NOT split", () => {
    const groups = groupByGap(
      [item("2019-07-04T10:00:00Z"), item("2019-07-04T11:00:00Z")],
      HOUR
    );
    assert.equal(groups.length, 1);
  });

  it("sorts unsorted input before grouping", () => {
    const groups = groupByGap(
      [
        item("2019-07-04T12:00:00Z", "c"),
        item("2019-07-04T10:00:00Z", "a"),
        item("2019-07-04T10:30:00Z", "b"),
      ],
      HOUR
    );
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].map((i) => i.name), ["a", "b"]);
    assert.deepEqual(groups[1].map((i) => i.name), ["c"]);
  });

  it("does not mutate the input array", () => {
    const input = [item("2019-07-04T12:00:00Z", "c"), item("2019-07-04T10:00:00Z", "a")];
    groupByGap(input, HOUR);
    assert.equal(input[0].name, "c");
  });

  it("40 photos over 3 days split at day boundaries (roadmap scenario)", () => {
    const days = ["2019-07-04", "2019-07-05", "2019-07-06"];
    const photos = days.flatMap((day, d) =>
      Array.from({ length: d === 1 ? 14 : 13 }, (_, i) =>
        item(`${day}T10:${String(i * 2).padStart(2, "0")}:00Z`)
      )
    );
    assert.equal(photos.length, 40);
    const groups = groupByGap(photos, GAP_THRESHOLDS[0].ms);
    assert.equal(groups.length, 3);
    assert.deepEqual(groups.map((g) => g.length), [13, 14, 13]);
  });

  it("wider thresholds produce fewer or equal groups", () => {
    const photos = Array.from({ length: 30 }, (_, i) =>
      item(new Date(Date.UTC(2019, 6, 4, i * 2)).toISOString())
    );
    let prev = Infinity;
    for (const t of GAP_THRESHOLDS) {
      const n = groupByGap(photos, t.ms).length;
      assert.ok(n <= prev, `${t.label} produced more groups than a narrower threshold`);
      prev = n;
    }
  });

  it("identical timestamps (scanned batch) stay in one group", () => {
    const groups = groupByGap(
      Array.from({ length: 20 }, () => item("2003-12-25T12:00:00Z")),
      HOUR
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].length, 20);
  });
});
