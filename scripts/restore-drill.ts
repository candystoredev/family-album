/**
 * Restore drill — proves a backup is actually restorable, not just uploaded.
 *
 * Downloads (or loads) a gzipped `.dump`-style SQL backup, restores it into a
 * fresh local SQLite file via @libsql/client, and runs sanity checks: core
 * tables exist, `posts`/`media` have rows, the `posts_fts` FTS5 table is
 * present, and an FTS MATCH query runs cleanly. Exits non-zero if any check
 * fails.
 *
 * Usage:
 *   npx tsx scripts/restore-drill.ts                    # download latest backups/*.sql.gz from R2
 *   npx tsx scripts/restore-drill.ts --file dump.sql.gz  # restore a local file (.sql or .sql.gz)
 *   npx tsx scripts/restore-drill.ts --self-test         # generate + restore a throwaway dump — no creds needed
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createClient, type Client } from "@libsql/client";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";

// ─── Load .env (same lightweight loader as scripts/migrate.ts) ─────────
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
    console.error(`Missing env var: ${key}`);
    process.exit(1);
  }
  return v;
}

// ─── R2 (backups bucket — separate from src/lib/r2.ts's media bucket) ──
function getR2Backup(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    },
  });
}

async function fetchLatestBackup(): Promise<Buffer> {
  const bucket = env("R2_BACKUP_BUCKET");
  const s3 = getR2Backup();
  const list = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: "backups/" }),
  );
  const keys = (list.Contents ?? [])
    .map((o) => o.Key)
    .filter((k): k is string => !!k && k.endsWith(".sql.gz"))
    .sort()
    .reverse(); // filenames are backups/thehoecks-YYYY-MM-DD.sql.gz — lexical sort == date sort

  if (!keys.length) {
    console.error(`No backups/*.sql.gz objects found in bucket ${bucket}`);
    process.exit(1);
  }

  const latest = keys[0];
  console.log(`Downloading latest backup: ${latest}`);
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: latest }));
  const bytes = await obj.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

// ─── Self-test fixture ───────────────────────────────────────────────
// Hand-written `.dump`-style SQL exercising the same shapes as the real
// schema: a plain table, a BLOB column (`embedding`), and an FTS5 virtual
// table — so the restore/verify logic gets a real workout without touching
// prod creds.
const SELF_TEST_DUMP = `
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE posts (id TEXT PRIMARY KEY, slug TEXT, title TEXT);
CREATE TABLE media (id TEXT PRIMARY KEY, post_id TEXT, embedding BLOB);
CREATE VIRTUAL TABLE posts_fts USING fts5(post_id UNINDEXED, title, body);
INSERT INTO posts VALUES('p1','hello-world','Hello World');
INSERT INTO media VALUES('m1','p1',X'0102030405');
INSERT INTO posts_fts(post_id, title, body) VALUES('p1','Hello World','Some sample body text about hello world, written for the restore drill self-test.');
COMMIT;
`.trim();

// ─── Checks ─────────────────────────────────────────────────────────
interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

async function runChecks(
  db: Client,
  ftsMatchTerm: string,
  expectFtsRows: boolean,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. Core tables exist
  for (const table of ["posts", "media"]) {
    try {
      const r = await db.execute({
        sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        args: [table],
      });
      results.push({
        name: `table \`${table}\` exists`,
        pass: r.rows.length > 0,
        detail: r.rows.length ? "found" : "missing",
      });
    } catch (e) {
      results.push({ name: `table \`${table}\` exists`, pass: false, detail: (e as Error).message });
    }
  }

  // 2. Row counts (posts and media must be non-empty for a healthy backup)
  for (const table of ["posts", "media"]) {
    try {
      const r = await db.execute(`SELECT COUNT(*) as n FROM ${table}`);
      const n = Number(r.rows[0]?.n ?? 0);
      results.push({ name: `\`${table}\` has rows`, pass: n > 0, detail: `${n} row(s)` });
    } catch (e) {
      results.push({ name: `\`${table}\` has rows`, pass: false, detail: (e as Error).message });
    }
  }

  // 3. FTS table present
  try {
    const r = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='posts_fts'",
      args: [],
    });
    const present = r.rows.length > 0;
    results.push({ name: "FTS table `posts_fts` present", pass: present, detail: present ? "found" : "missing" });
  } catch (e) {
    results.push({ name: "FTS table `posts_fts` present", pass: false, detail: (e as Error).message });
  }

  // 4. FTS query runs without error. For the self-test we also assert it
  // actually returns the known fixture row — that proves the FTS index was
  // restored with real content, not just an empty virtual table.
  try {
    const r = await db.execute({
      sql: "SELECT post_id FROM posts_fts WHERE posts_fts MATCH ?",
      args: [ftsMatchTerm],
    });
    const ok = expectFtsRows ? r.rows.length > 0 : true;
    results.push({
      name: `FTS query (MATCH '${ftsMatchTerm}') runs without error`,
      pass: ok,
      detail: `${r.rows.length} row(s) matched`,
    });
  } catch (e) {
    results.push({
      name: `FTS query (MATCH '${ftsMatchTerm}') runs without error`,
      pass: false,
      detail: (e as Error).message,
    });
  }

  return results;
}

function printReport(results: CheckResult[]) {
  console.log("\nRestore drill report:");
  for (const r of results) {
    console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name} — ${r.detail}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const selfTest = args.includes("--self-test");
  const fileFlagIdx = args.findIndex((a) => a === "--file");
  const fileArg = fileFlagIdx >= 0 ? args[fileFlagIdx + 1] : undefined;

  let sqlText: string;
  let source: string;

  if (selfTest) {
    console.log("Self-test mode: generating a throwaway dump (no R2/Turso creds needed)...\n");
    const fixturePath = resolve(tmpdir(), `restore-drill-self-test-${Date.now()}.sql`);
    writeFileSync(fixturePath, SELF_TEST_DUMP, "utf-8");
    sqlText = readFileSync(fixturePath, "utf-8");
    source = fixturePath;
    rmSync(fixturePath, { force: true });
  } else if (fileArg) {
    console.log(`Loading local file: ${fileArg}`);
    const buf = readFileSync(fileArg);
    sqlText = fileArg.endsWith(".gz") ? gunzipSync(buf).toString("utf-8") : buf.toString("utf-8");
    source = fileArg;
  } else {
    const gz = await fetchLatestBackup();
    sqlText = gunzipSync(gz).toString("utf-8");
    source = "latest R2 backup";
  }

  const dbPath = resolve(tmpdir(), `restore-drill-${Date.now()}.db`);
  console.log(`Restoring "${source}" into fresh local DB: ${dbPath}`);

  const db = createClient({ url: `file:${dbPath}` });
  try {
    await db.executeMultiple(sqlText);

    // Only the self-test fixture guarantees a known FTS match — for a real
    // prod dump we don't know the content, so just prove the query executes.
    const results = await runChecks(db, selfTest ? "hello" : "the", selfTest);
    printReport(results);

    const allPass = results.every((r) => r.pass);
    if (allPass) {
      console.log("\nRestore drill PASSED — dump is restorable and structurally sound.\n");
    } else {
      console.error("\nRestore drill FAILED — see failing checks above.\n");
      process.exit(1);
    }
  } finally {
    db.close();
    if (existsSync(dbPath)) rmSync(dbPath, { force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
