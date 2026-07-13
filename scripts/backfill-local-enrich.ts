#!/usr/bin/env tsx
/**
 * Local-enrichment backfill (Phase 10.1e for the historical archive).
 *
 * Walks every media row and fills in, using ONLY local/deterministic tools —
 * no AI API, nothing leaves your machine except reads from R2 and writes to
 * the DB:
 *
 *   1. phash + dominant colour where missing (pre-Phase-10 rows, e.g. the
 *      Tumblr migration) — computed from the stored THUMBNAIL with the exact
 *      algorithm live uploads use, so /api/admin/similar-tags can match old
 *      posts too.
 *   2. OCR (tesseract.js in Node) over the served image, with written-date
 *      extraction — stored verbatim to media_metadata_raw (source='ocr').
 *   3. A date-conflict report: posts whose OCR'd evidence (an invitation, a
 *      banner) disagrees with the displayed date, using the same suggestion
 *      rules as the compose page. REPORT ONLY — nothing mutates post dates.
 *
 * Re-runnable and resumable: rows that already have a phash and an OCR
 * payload are skipped, so an interrupted run just continues where it left off.
 *
 * Usage (point at prod, same env as other scripts — .env is auto-loaded):
 *   npx tsx scripts/backfill-local-enrich.ts [options]
 *
 * Options:
 *   --dry-run       Compute everything, write nothing, still print the report
 *   --limit=N       Process at most N media rows this run
 *   --phash-only    Skip OCR (phash pass is ~100ms/item; OCR is 1-3s/item)
 *   --report=PATH   Also write the date-conflict report as JSON
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import { perceptualHash, dominantColor } from "../src/lib/media/image-hash";
import { extractDatesFromText } from "../src/lib/enrich/extract-dates";
import { pickDateSuggestion } from "../src/lib/enrich/date-evidence";
import type { DateEvidence, OcrResult } from "../src/lib/enrich/types";

// ─── Args (before env so --help-ish failures are friendly) ─────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const PHASH_ONLY = args.includes("--phash-only");
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? Infinity);
const REPORT_PATH = args.find((a) => a.startsWith("--report="))?.split("=")[1];

// ─── Load .env (same pattern as migrate.ts) ─────────────────────────────────
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

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
  },
});
const BUCKET = env("R2_BUCKET_NAME");

async function download(key: string): Promise<Buffer | null> {
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  } catch {
    return null; // missing object — skip, don't abort the run
  }
}

// ─── OCR worker (lazy — only if OCR is actually needed) ─────────────────────
type Worker = { recognize: (b: Buffer) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> };
let worker: Worker | null = null;
async function ocr(buf: Buffer): Promise<string> {
  if (!worker) {
    const { createWorker } = await import("tesseract.js");
    worker = (await createWorker("eng", undefined, {
      cachePath: resolve(__dirname, "../.tesseract-cache"),
    })) as unknown as Worker;
  }
  try {
    const { data } = await worker.recognize(buf);
    return data.text ?? "";
  } catch {
    return "";
  }
}

interface MediaRow {
  id: string;
  post_id: string;
  type: string;
  r2_key: string;
  thumbnail_r2_key: string | null;
  phash: string | null;
  dominant_color: string | null;
  has_ocr: number;
}

async function main() {
  const currentYear = new Date().getUTCFullYear();
  console.log(
    `Local-enrichment backfill${DRY_RUN ? " (DRY RUN)" : ""}${PHASH_ONLY ? " (phash only)" : ""}`
  );

  const rows = (
    await db.execute(`
      SELECT m.id, m.post_id, m.type, m.r2_key, m.thumbnail_r2_key, m.phash, m.dominant_color,
             EXISTS(SELECT 1 FROM media_metadata_raw r WHERE r.media_id = m.id AND r.source = 'ocr') AS has_ocr
      FROM media m ORDER BY m.id
    `)
  ).rows as unknown as MediaRow[];

  // Per-post OCR evidence for the conflict report (includes evidence already
  // in the DB from previous runs, so the report is complete every time).
  const evidenceByPost = new Map<string, DateEvidence[]>();
  const priorOcr = await db.execute(`
    SELECT m.post_id, r.payload FROM media_metadata_raw r
    INNER JOIN media m ON m.id = r.media_id WHERE r.source = 'ocr'
  `);
  for (const row of priorOcr.rows) {
    try {
      const payload = JSON.parse(row.payload as string) as OcrResult;
      if (payload.dates?.length) {
        const list = evidenceByPost.get(row.post_id as string) ?? [];
        list.push(...payload.dates);
        evidenceByPost.set(row.post_id as string, list);
      }
    } catch {
      /* unparseable payload — ignore */
    }
  }

  let processed = 0;
  let phashed = 0;
  let ocrd = 0;
  let skipped = 0;

  for (const m of rows) {
    if (processed >= LIMIT) break;
    const needsPhash = !m.phash;
    const needsOcr = !PHASH_ONLY && !m.has_ocr;
    if (!needsPhash && !needsOcr) {
      skipped++;
      continue;
    }
    processed++;

    // phash MUST come from the thumbnail — live uploads hash the thumbnail,
    // and hashes are only comparable when computed from the same rendition.
    if (needsPhash) {
      const thumbKey = m.thumbnail_r2_key || (m.type === "photo" ? m.r2_key : null);
      const thumb = thumbKey ? await download(thumbKey) : null;
      if (thumb) {
        const [hash, color] = await Promise.all([perceptualHash(thumb), dominantColor(thumb)]);
        if (hash && !DRY_RUN) {
          await db.execute({
            sql: "UPDATE media SET phash = ?, dominant_color = COALESCE(dominant_color, ?) WHERE id = ?",
            args: [hash, color, m.id],
          });
        }
        if (hash) phashed++;
      }
    }

    // OCR reads the SERVED image (bigger than the thumb → better on small
    // text). Videos only have a poster thumb, so use that.
    if (needsOcr) {
      const imageKey = m.type === "photo" ? m.r2_key : m.thumbnail_r2_key;
      const image = imageKey ? await download(imageKey) : null;
      if (image) {
        const text = (await ocr(image)).trim();
        const dates = extractDatesFromText(text, currentYear);
        if (text || dates.length > 0) {
          const payload: OcrResult = { text, dates, version: 1 };
          if (!DRY_RUN) {
            await db.execute({
              sql: "INSERT INTO media_metadata_raw (id, media_id, source, payload) VALUES (?, ?, 'ocr', ?)",
              args: [nanoid(), m.id, JSON.stringify(payload)],
            });
          }
          ocrd++;
          if (dates.length > 0) {
            const list = evidenceByPost.get(m.post_id) ?? [];
            list.push(...dates);
            evidenceByPost.set(m.post_id, list);
          }
        }
      }
    }

    if (processed % 25 === 0) {
      console.log(`  …${processed} processed (${phashed} hashed, ${ocrd} OCR'd)`);
    }
  }

  console.log(
    `\nDone: ${processed} processed, ${phashed} phashes written, ${ocrd} OCR payloads, ${skipped} already complete.`
  );

  // ─── Date-conflict report (read-only) ─────────────────────────────────────
  if (evidenceByPost.size > 0) {
    const ids = [...evidenceByPost.keys()];
    const conflicts: {
      slug: string;
      shownDate: string;
      evidenceDate: string;
      quotedText: string;
      conflict: boolean;
    }[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const posts = await db.execute({
        sql: `SELECT id, slug, date_source, COALESCE(local_date, substr(date,1,10)) AS eff_day
              FROM posts WHERE id IN (${chunk.map(() => "?").join(",")})`,
        args: chunk,
      });
      for (const p of posts.rows) {
        const suggestion = pickDateSuggestion(evidenceByPost.get(p.id as string)!, {
          localDate: p.eff_day as string,
          source: p.date_source as string | null,
        });
        if (suggestion) {
          conflicts.push({
            slug: p.slug as string,
            shownDate: p.eff_day as string,
            evidenceDate: suggestion.date,
            quotedText: suggestion.quotedText,
            conflict: suggestion.conflict,
          });
        }
      }
    }
    if (conflicts.length > 0) {
      console.log(`\n${conflicts.length} post(s) where photo text disagrees with the shown date:`);
      for (const c of conflicts) {
        console.log(
          `  /posts/${c.slug}: shown ${c.shownDate}, photo says ${c.evidenceDate} ("${c.quotedText}")`
        );
      }
      console.log("\nNothing was changed — fix any real ones via the post's edit page.");
    } else {
      console.log("\nNo date conflicts found between photo text and shown dates.");
    }
    if (REPORT_PATH) {
      writeFileSync(REPORT_PATH, JSON.stringify(conflicts, null, 2));
      console.log(`Report written to ${REPORT_PATH}`);
    }
  }

  if (worker) await worker.terminate();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
