import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";

/**
 * Offline reverse geocoding against a committed GeoNames-derived dataset
 * (src/lib/geo/data/places.json.gz). No network, no new dependencies — just
 * `fs` + `zlib` and a haversine nearest-neighbour scan over ~69k places.
 *
 * The dataset is a gzipped JSON array of compact rows:
 *   [name, lat, lng, admin2Name, admin1Name, countryName]
 * with empty strings for missing admin levels and lat/lng rounded to 4 dp.
 * See scripts/build-geo-dataset.ts for how it's produced.
 *
 * Node runtime only (uses `fs`/`zlib`); every consumer route runs on the Node
 * runtime, none on Edge.
 */

/** A single compact place row as stored in places.json.gz. */
export type PlaceRow = [
  name: string,
  lat: number,
  lng: number,
  admin2: string,
  admin1: string,
  country: string,
];

export interface ReverseGeocodeResult {
  name: string;
  admin2: string | null;
  admin1: string | null;
  country: string | null;
  /** [name, admin2, admin1, country] joined ", ", empties skipped, consecutive dups collapsed. */
  label: string;
}

/** Beyond this great-circle distance to the nearest known place, we return null. */
const MAX_DISTANCE_KM = 50;

/**
 * A ±0.5° latitude band spans ~55 km north-south, so it is guaranteed to
 * contain every place within MAX_DISTANCE_KM (≤0.45° of latitude). We still
 * widen the band if it comes up empty, purely as defensive robustness.
 */
const INITIAL_BAND_DEG = 0.5;
const MAX_BAND_DEG = 8;

// Module-cached dataset, sorted ascending by latitude for the band prefilter.
let dataset: PlaceRow[] | null = null;

function resolveDatasetPath(): string {
  // process.cwd() is the project root both under `next build`/server (Vercel
  // and `next start`) and under `tsx scripts/*.ts`, so this resolves the
  // committed dataset in both environments without import.meta gymnastics.
  return path.join(process.cwd(), "src", "lib", "geo", "data", "places.json.gz");
}

function loadDataset(): PlaceRow[] {
  if (dataset) return dataset;
  const gz = readFileSync(resolveDatasetPath());
  const rows = JSON.parse(gunzipSync(gz).toString("utf8")) as PlaceRow[];
  rows.sort((a, b) => a[1] - b[1]);
  dataset = rows;
  return rows;
}

/**
 * Inject a fixture dataset for unit tests (or reset with null to fall back to
 * the committed file). Rows are copied and re-sorted by latitude so callers
 * don't have to pre-sort their fixtures.
 */
export function _setDatasetForTests(rows: PlaceRow[] | null): void {
  dataset = rows ? [...rows].sort((a, b) => a[1] - b[1]) : null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** First index whose row latitude is >= `targetLat` (binary search). */
function lowerBoundByLat(rows: PlaceRow[], targetLat: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][1] < targetLat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function nonEmpty(s: string): string | null {
  return s && s.trim() ? s : null;
}

/**
 * Build the display label: [name, admin2, admin1, country] joined with ", ",
 * skipping empties and collapsing consecutive duplicates (e.g. a city whose
 * name equals its admin2 won't repeat).
 */
function buildLabel(parts: Array<string | null>): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (out.length > 0 && out[out.length - 1] === p) continue;
    out.push(p);
  }
  return out.join(", ");
}

/**
 * Reverse-geocode a coordinate to its nearest known place, or null when no
 * place lies within MAX_DISTANCE_KM (e.g. mid-ocean). Pure and synchronous.
 */
export function reverseGeocode(lat: number, lng: number): ReverseGeocodeResult | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const rows = loadDataset();
  if (rows.length === 0) return null;

  let best: PlaceRow | null = null;
  let bestDist = Infinity;
  for (let band = INITIAL_BAND_DEG; band <= MAX_BAND_DEG; band *= 2) {
    const start = lowerBoundByLat(rows, lat - band);
    const hi = lat + band;
    for (let i = start; i < rows.length && rows[i][1] <= hi; i++) {
      const d = haversineKm(lat, lng, rows[i][1], rows[i][2]);
      if (d < bestDist) {
        bestDist = d;
        best = rows[i];
      }
    }
    if (best) break; // band captures every sub-50km candidate; no need to widen
  }

  if (!best || bestDist > MAX_DISTANCE_KM) return null;

  const admin2 = nonEmpty(best[3]);
  const admin1 = nonEmpty(best[4]);
  const country = nonEmpty(best[5]);
  return {
    name: best[0],
    admin2,
    admin1,
    country,
    label: buildLabel([best[0], admin2, admin1, country]),
  };
}
