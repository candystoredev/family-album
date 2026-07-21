#!/usr/bin/env tsx
/**
 * Reverse-geocode backfill (Part 2, Workstream A).
 *
 * Fills `media.place` for every photo that has GPS coordinates but no cached
 * place label yet, using ONLY the committed offline dataset — zero network
 * beyond the database itself (no geocoding API, nothing leaves your machine
 * except reads/writes to Turso). Then rebuilds the FTS index once so the new
 * place labels (and any existing captions) become searchable.
 *
 * Re-runnable and idempotent: rows that already have a place are skipped, so an
 * interrupted run just continues, and a second run is a no-op.
 *
 * Usage (same env as the other scripts — .env is auto-loaded):
 *   npx tsx scripts/backfill-geocode.ts [options]
 *
 * Options:
 *   --dry-run       Compute everything, write nothing (no UPDATEs, no rebuild)
 *   --limit=N       Process at most N media rows this run
 *   --report=PATH   Write a JSON report of every (mediaId → place) resolved
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { reverseGeocode } from "../src/lib/geo/reverse";

// ─── Args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? Infinity);
const REPORT_PATH = args.find((a) => a.startsWith("--report="))?.split("=")[1];

// ─── Load .env (same pattern as backfill-local-enrich.ts / migrate.ts) ───────
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const raw = readFileSync(resolve(__dirname, "../.env"), "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([^#\s=]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* .env not found — env vars must be set externally */
}

function env(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing env var ${key} — set it or add it to .env`);
    process.exit(1);
  }
  return v;
}

const db = createClient({
  url: env("TURSO_DATABASE_URL"),
  authToken: process.env.TURSO_AUTH_TOKEN,
});

interface GpsRow {
  id: string;
  post_id: string;
  gps_lat: number;
  gps_lng: number;
}

/**
 * Rebuild posts_fts from the source tables against the raw client, replicating
 * src/lib/schema.ts rebuildFtsIndex() (7-column shape). Ensures the table is the
 * current (…, place, captions) shape first — probes for the new columns and
 * migrates (drop + create) if an older shape is found.
 */
async function rebuildFts(): Promise<void> {
  let currentShape = false;
  try {
    await db.execute(`SELECT place, captions FROM posts_fts LIMIT 0`);
    currentShape = true;
  } catch {
    // Table missing or older shape — recreate below.
  }
  if (!currentShape) {
    await db.execute(`DROP TABLE IF EXISTS posts_fts`);
    await db.execute(`CREATE VIRTUAL TABLE posts_fts USING fts5(
      post_id UNINDEXED, title, body, tags, people, place, captions
    )`);
  }
  await db.execute(`DELETE FROM posts_fts`);
  await db.execute(`INSERT INTO posts_fts(post_id, title, body, tags, people, place, captions)
    SELECT
      p.id,
      COALESCE(p.title, ''),
      COALESCE(p.body, ''),
      COALESCE((SELECT GROUP_CONCAT(t.name, ' ') FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id), ''),
      COALESCE((SELECT GROUP_CONCAT(pe.name, ' ') FROM post_people pp JOIN people pe ON pe.id = pp.person_id WHERE pp.post_id = p.id), ''),
      COALESCE((SELECT GROUP_CONCAT(place, ' ') FROM (SELECT DISTINCT m.place AS place FROM media m WHERE m.post_id = p.id AND m.place IS NOT NULL AND m.place <> '')), ''),
      COALESCE((SELECT GROUP_CONCAT(m.caption, ' ') FROM media m WHERE m.post_id = p.id AND m.caption IS NOT NULL AND m.caption <> ''), '')
    FROM posts p`);
}

async function main() {
  console.log(`Reverse-geocode backfill${DRY_RUN ? " (DRY RUN)" : ""}`);

  const rows = (
    await db.execute(`
      SELECT id, post_id, gps_lat, gps_lng
      FROM media
      WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL AND place IS NULL
      ORDER BY id
    `)
  ).rows as unknown as GpsRow[];

  console.log(`${rows.length} media row(s) with GPS and no cached place.`);

  let processed = 0;
  let resolved = 0;
  let unresolved = 0;
  const report: { mediaId: string; postId: string; lat: number; lng: number; place: string }[] = [];

  for (const m of rows) {
    if (processed >= LIMIT) break;
    processed++;

    let label: string | null = null;
    try {
      label = reverseGeocode(m.gps_lat, m.gps_lng)?.label ?? null;
    } catch (e) {
      console.error(`  geocode failed for ${m.id}:`, e instanceof Error ? e.message : e);
      label = null;
    }

    if (!label) {
      unresolved++;
      continue;
    }

    if (!DRY_RUN) {
      await db.execute({
        sql: "UPDATE media SET place = ? WHERE id = ? AND place IS NULL",
        args: [label, m.id],
      });
    }
    resolved++;
    report.push({ mediaId: m.id, postId: m.post_id, lat: m.gps_lat, lng: m.gps_lng, place: label });

    if (processed % 100 === 0) {
      console.log(`  …${processed} processed (${resolved} resolved, ${unresolved} unresolved)`);
    }
  }

  console.log(
    `\nDone: ${processed} processed, ${resolved} places written, ${unresolved} unresolved (no place within range).`
  );

  // Rebuild FTS once so the new place labels become searchable. Skipped on a
  // dry run and when nothing changed.
  if (!DRY_RUN && resolved > 0) {
    console.log("Rebuilding FTS index…");
    await rebuildFts();
    console.log("FTS index rebuilt.");
  } else if (DRY_RUN) {
    console.log("Dry run — FTS index not rebuilt.");
  }

  if (REPORT_PATH) {
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`Report written to ${REPORT_PATH} (${report.length} entries).`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
