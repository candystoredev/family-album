#!/usr/bin/env tsx
/**
 * Build the offline reverse-geocoding dataset consumed by src/lib/geo/reverse.ts.
 *
 * Sources: GeoNames (https://www.geonames.org/), licensed CC-BY 4.0 —
 * attribution lives in docs/ARCHITECTURE.md. Downloads three dumps
 * (cities5000 = every place with population ≥ 5000, plus the admin1/admin2
 * code→name lookups), trims them to the fields the geocoder needs, and writes
 * a gzipped compact-array JSON to src/lib/geo/data/places.json.gz.
 *
 * Usage:
 *   npm run build:geo                # download from download.geonames.org
 *   tsx scripts/build-geo-dataset.ts --src=/path/to/dir   # use pre-downloaded
 *     files (cities5000.zip or cities5000.txt, admin1CodesASCII.txt,
 *     admin2Codes.txt) — handy offline or behind a strict proxy.
 *
 * Downloads shell out to curl: Node's fetch through the dev environment's
 * HTTPS proxy truncates large bodies, curl does not.
 *
 * Output row shape (array-of-arrays to keep the file small):
 *   [name, lat, lng, admin2Name, admin1Name, countryName]
 * lat/lng rounded to 4 decimals (~11 m). Empty strings for missing admin
 * levels. Country codes are resolved to English names via Intl.DisplayNames.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

const GEONAMES_BASE = "https://download.geonames.org/export/dump";
const OUT_PATH = path.join(__dirname, "..", "src", "lib", "geo", "data", "places.json.gz");

const srcArg = process.argv.find((a) => a.startsWith("--src="))?.split("=")[1];

function fetchSources(): string {
  if (srcArg) {
    if (!existsSync(srcArg)) {
      console.error(`--src directory not found: ${srcArg}`);
      process.exit(1);
    }
    return srcArg;
  }
  const dir = path.join(tmpdir(), "geonames-src");
  mkdirSync(dir, { recursive: true });
  for (const file of ["cities5000.zip", "admin1CodesASCII.txt", "admin2Codes.txt"]) {
    const dest = path.join(dir, file);
    if (existsSync(dest)) continue;
    console.log(`downloading ${file}…`);
    execFileSync("curl", ["-sSL", "--fail", "-o", dest, `${GEONAMES_BASE}/${file}`]);
  }
  return dir;
}

/** Ensure cities5000.txt exists in dir, extracting the zip if needed. */
function citiesTxt(dir: string): string {
  const txt = path.join(dir, "cities5000.txt");
  if (!existsSync(txt)) {
    execFileSync("unzip", ["-o", "-q", path.join(dir, "cities5000.zip"), "-d", dir]);
  }
  return txt;
}

/** Parse "CODE\tName\t…" lookup dumps into a Map keyed by CODE. */
function parseCodeLookup(file: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    const [code, name] = line.split("\t");
    if (code && name) map.set(code, name);
  }
  return map;
}

function main() {
  const dir = fetchSources();
  const admin1 = parseCodeLookup(path.join(dir, "admin1CodesASCII.txt"));
  const admin2 = parseCodeLookup(path.join(dir, "admin2Codes.txt"));
  const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

  // cities5000.txt columns (GeoNames readme): 1=name, 4=lat, 5=lng,
  // 8=country code, 10=admin1 code, 11=admin2 code.
  const rows: [string, number, number, string, string, string][] = [];
  for (const line of readFileSync(citiesTxt(dir), "utf8").split("\n")) {
    if (!line) continue;
    const cols = line.split("\t");
    const name = cols[1];
    const lat = Number(cols[4]);
    const lng = Number(cols[5]);
    const cc = cols[8];
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    let country = "";
    try {
      country = (cc && regionNames.of(cc)) || "";
    } catch {
      // unknown/nonstandard code — leave blank rather than fail the build
    }
    rows.push([
      name,
      Math.round(lat * 1e4) / 1e4,
      Math.round(lng * 1e4) / 1e4,
      (cols[11] && admin2.get(`${cc}.${cols[10]}.${cols[11]}`)) || "",
      (cols[10] && admin1.get(`${cc}.${cols[10]}`)) || "",
      country,
    ]);
  }

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const gz = gzipSync(Buffer.from(JSON.stringify(rows)), { level: 9 });
  writeFileSync(OUT_PATH, gz);
  console.log(
    `wrote ${rows.length} places → ${path.relative(process.cwd(), OUT_PATH)} (${(gz.length / 1024 / 1024).toFixed(2)} MB gzipped)`
  );
}

main();
