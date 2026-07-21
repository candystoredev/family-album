import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  reverseGeocode,
  _setDatasetForTests,
  type PlaceRow,
} from "../src/lib/geo/reverse";

/**
 * Reverse geocoder (Part 2, Workstream A). Unit tests inject a tiny fixture via
 * _setDatasetForTests so nearest-pick / distance-cap / label logic is exercised
 * deterministically; a final pair of assertions runs against the real committed
 * dataset (src/lib/geo/data/places.json.gz) without ever dumping its contents.
 */

describe("reverseGeocode — unit (injected fixture)", () => {
  afterEach(() => _setDatasetForTests(null)); // reset to the real dataset

  it("picks the nearest place, not just the first in the band", () => {
    _setDatasetForTests([
      ["Alpha", 0, 0, "A2", "A1", "AC"],
      ["Beta", 0.1, 0.1, "B2", "B1", "BC"],
    ] as PlaceRow[]);
    const r = reverseGeocode(0.09, 0.09);
    assert.equal(r?.name, "Beta");
    const r2 = reverseGeocode(0.01, 0.01);
    assert.equal(r2?.name, "Alpha");
  });

  it("returns null when the nearest place is beyond 50 km", () => {
    _setDatasetForTests([["Far", 0, 0, "", "", "FC"]] as PlaceRow[]);
    // ~157 km away → null
    assert.equal(reverseGeocode(1, 1), null);
    // ~11 km away → resolves
    assert.equal(reverseGeocode(0.1, 0)?.name, "Far");
  });

  it("builds the full label from all four components", () => {
    _setDatasetForTests([
      ["Truro", 50, -5, "Cornwall", "England", "United Kingdom"],
    ] as PlaceRow[]);
    const r = reverseGeocode(50, -5);
    assert.equal(r?.label, "Truro, Cornwall, England, United Kingdom");
    assert.equal(r?.admin2, "Cornwall");
    assert.equal(r?.admin1, "England");
    assert.equal(r?.country, "United Kingdom");
  });

  it("skips empty admin levels and nulls them in the result", () => {
    _setDatasetForTests([["Nowhere", 10, 10, "", "Region", "Country"]] as PlaceRow[]);
    const r = reverseGeocode(10, 10);
    assert.equal(r?.label, "Nowhere, Region, Country");
    assert.equal(r?.admin2, null);
    assert.equal(r?.admin1, "Region");
    assert.equal(r?.country, "Country");
  });

  it("collapses consecutive duplicate components in the label", () => {
    // A city whose name equals its admin2 must not repeat.
    _setDatasetForTests([
      ["London", 51.5, -0.1, "London", "England", "United Kingdom"],
    ] as PlaceRow[]);
    assert.equal(
      reverseGeocode(51.5, -0.1)?.label,
      "London, England, United Kingdom"
    );
  });

  it("returns null for non-finite coordinates", () => {
    _setDatasetForTests([["Alpha", 0, 0, "", "", "AC"]] as PlaceRow[]);
    assert.equal(reverseGeocode(NaN, 0), null);
    assert.equal(reverseGeocode(0, Infinity), null);
  });
});

describe("reverseGeocode — real committed dataset", () => {
  it("resolves the Cornwall coordinate to a Cornwall label", () => {
    _setDatasetForTests(null); // use the real places.json.gz
    const r = reverseGeocode(50.266, -5.052);
    assert.ok(r, "expected a result near Truro");
    assert.ok(
      r!.label.includes("Cornwall"),
      `expected label to contain "Cornwall", got a ${r!.label.length}-char label`
    );
  });

  it("returns null for a mid-Atlantic point with no nearby place", () => {
    _setDatasetForTests(null);
    assert.equal(reverseGeocode(45, -35), null);
  });
});
