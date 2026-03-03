#!/usr/bin/env tsx
/**
 * Tumblr → The Hoecks Migration Script
 *
 * Fetches all posts from the Tumblr blog via NPF API, downloads media,
 * generates thumbnails, uploads to R2, and inserts into Turso DB.
 *
 * Usage:
 *   npx tsx scripts/migrate.ts [options]
 *
 * Options:
 *   --dry-run        List posts without writing anything
 *   --clean-seed     Delete seed/test posts before migrating
 *   --limit=N        Process only the first N posts
 *   --offset=N       Skip the first N fetched posts
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import sharp from "sharp";

// ─── Load .env ──────────────────────────────────────────────
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

// ─── Config ─────────────────────────────────────────────────
function env(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing env var: ${key}`);
    process.exit(1);
  }
  return v;
}

const TUMBLR_API_KEY = env("TUMBLR_OAUTH_CONSUMER_KEY");
const BLOG_ID = "thehoecks.tumblr.com";
const BATCH_SIZE = 20;
const THUMB_WIDTH = 400;
const DL_TIMEOUT_IMG = 60_000;
const DL_TIMEOUT_VID = 180_000; // videos can be large
const DL_RETRIES = 3;

/**
 * Tags matching these names (lowercase) are routed to post_people
 * instead of post_tags. Add family member first names here.
 */
const PEOPLE: Set<string> = new Set([
  "anna", "margot", "rosie", "tom", "victoria",
  "nani", "papaw", "mamie annie", "mawmaw",
]);

// ─── Clients (lazy — not created until first use) ───────────
let _db: Client | null = null;
function getDb(): Client {
  if (!_db) {
    _db = createClient({
      url: env("TURSO_DATABASE_URL"),
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _db;
}

let _r2: S3Client | null = null;
function getR2(): S3Client {
  if (!_r2) {
    _r2 = new S3Client({
      region: "auto",
      endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env("R2_ACCESS_KEY_ID"),
        secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return _r2;
}
const BUCKET = process.env.R2_BUCKET_NAME || "thehoecks-media";

// ─── Types ──────────────────────────────────────────────────
interface TumblrPost {
  id_string: string;
  slug: string;
  summary: string;
  timestamp: number;
  tags: string[];
  content: Block[];
  layout: LayoutBlock[];
}

interface Block {
  type: string;
  text?: string;
  media?: Media[] | Media; // array for images, single object for videos
  alt_text?: string;
  poster?: Media[];
  provider?: string;
  url?: string;
}

interface Media {
  url: string;
  type: string;
  width: number;
  height: number;
  has_original_dimensions?: boolean;
}

interface LayoutBlock {
  type: string;
  display?: { blocks: number[] }[];
}

// ─── Utilities ──────────────────────────────────────────────
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function extFor(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
  };
  return map[mime] || "bin";
}

function detectType(blocks: Block[]): "photo" | "video" | "mixed" | "text" {
  const img = blocks.some((b) => b.type === "image");
  const vid = blocks.some((b) => b.type === "video");
  if (img && vid) return "mixed";
  if (vid) return "video";
  if (img) return "photo";
  return "text";
}

function deriveLayout(blocks: Block[], layouts: LayoutBlock[]): string | null {
  const n = blocks.filter((b) => b.type === "image").length;
  if (n <= 1) return null;
  const rows = layouts.find((l) => l.type === "rows");
  if (rows?.display) return rows.display.map((r) => r.blocks.length).join("");
  return "1".repeat(n);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function dl(url: string, isVideo = false): Promise<Buffer> {
  const timeout = isVideo ? DL_TIMEOUT_VID : DL_TIMEOUT_IMG;
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= DL_RETRIES; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      lastErr = e as Error;
      if (attempt < DL_RETRIES) {
        const wait = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
        console.log(`    retry ${attempt}/${DL_RETRIES} in ${wait}ms: ${lastErr.message}`);
        await new Promise((r) => setTimeout(r, wait));
      }
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr!;
}

async function mkThumb(buf: Buffer, mime: string): Promise<Buffer> {
  return sharp(buf, mime === "image/gif" ? { animated: false } : undefined)
    .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function r2Put(key: string, body: Buffer, ct: string) {
  await getR2().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: ct,
    }),
  );
}

// ─── Tag / People caches ────────────────────────────────────
const tagCache = new Map<string, string>();
const personCache = new Map<string, string>();

async function ensureTag(name: string): Promise<string> {
  const s = slugify(name);
  if (tagCache.has(s)) return tagCache.get(s)!;
  const res = await getDb().execute({
    sql: "SELECT id FROM tags WHERE slug=?",
    args: [s],
  });
  if (res.rows.length) {
    tagCache.set(s, res.rows[0].id as string);
    return tagCache.get(s)!;
  }
  const id = nanoid();
  await getDb().execute({
    sql: "INSERT INTO tags(id,name,slug) VALUES(?,?,?)",
    args: [id, name, s],
  });
  tagCache.set(s, id);
  return id;
}

async function ensurePerson(name: string): Promise<string> {
  const s = slugify(name);
  if (personCache.has(s)) return personCache.get(s)!;
  const res = await getDb().execute({
    sql: "SELECT id FROM people WHERE slug=?",
    args: [s],
  });
  if (res.rows.length) {
    personCache.set(s, res.rows[0].id as string);
    return personCache.get(s)!;
  }
  const id = nanoid();
  await getDb().execute({
    sql: "INSERT INTO people(id,name,slug) VALUES(?,?,?)",
    args: [id, name, s],
  });
  personCache.set(s, id);
  return id;
}

// ─── Fetch posts from Tumblr ────────────────────────────────
async function fetchAll(maxCount = Infinity): Promise<TumblrPost[]> {
  const all: TumblrPost[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (true) {
    const p = new URLSearchParams({
      api_key: TUMBLR_API_KEY,
      limit: String(BATCH_SIZE),
      npf: "true",
    });
    if (cursor) p.set("page_number", cursor);

    console.log(`  Page ${++page}...`);
    const res = await fetch(
      `https://api.tumblr.com/v2/blog/${BLOG_ID}/posts?${p}`,
    );
    if (!res.ok) throw new Error(`Tumblr API ${res.status}`);

    const json = await res.json();
    const posts: TumblrPost[] = json.response.posts;
    if (!posts?.length) break;

    all.push(...posts);
    const total = json.response.total_posts;
    process.stdout.write(`\r  ${all.length} / ${total} fetched`);

    // Stop early if we have enough for offset + limit
    if (all.length >= maxCount) break;

    const next = json.response._links?.next;
    if (!next) break;
    cursor = next.query_params.page_number;

    // Rate limiting
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log();
  return all;
}

// ─── Migrate one post ───────────────────────────────────────
async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let suffix = 1;
  while (true) {
    const row = await getDb().execute({
      sql: "SELECT id FROM posts WHERE slug=?",
      args: [slug],
    });
    if (!row.rows.length) return slug;
    suffix++;
    slug = `${base}-${suffix}`;
  }
}

async function migrate(
  post: TumblrPost,
  idx: number,
  total: number,
): Promise<"ok" | "skip" | "fail"> {
  // Resolve slug (ensure non-empty, use Tumblr ID as last resort)
  const baseSlug = post.slug || slugify(post.summary || "") || `post-${post.id_string}`;

  // Skip if this exact Tumblr post was already migrated (check by tumblr_id)
  const dup = await getDb().execute({
    sql: "SELECT id FROM posts WHERE tumblr_id=?",
    args: [post.id_string],
  });
  if (dup.rows.length) {
    console.log(`  [${idx}/${total}] skip  ${baseSlug} (already migrated)`);
    return "skip";
  }

  const slug = await uniqueSlug(baseSlug);
  const postId = nanoid();
  const title = post.summary?.trim() || null;
  const type = detectType(post.content);
  const layout = deriveLayout(post.content, post.layout);
  const date = new Date(post.timestamp * 1000).toISOString();

  // Body from text blocks (omit if it just duplicates the title)
  const texts = post.content.filter((b) => b.type === "text" && b.text);
  let body: string | null = null;
  if (texts.length) {
    const raw = texts.map((b) => b.text!).join("\n");
    if (raw !== title)
      body = texts.map((b) => `<p>${escapeHtml(b.text!)}</p>`).join("");
  }

  const mediaBlocks = post.content.filter(
    (b) => b.type === "image" || b.type === "video",
  );
  console.log(
    `  [${idx}/${total}] ${slug} (${type}, ${mediaBlocks.length} media)`,
  );

  // ── Begin transaction: collect all DB statements, execute as batch ──
  const stmts: { sql: string; args: (string | number | null)[] }[] = [];

  // 1. Insert post
  stmts.push({
    sql: "INSERT INTO posts(id,slug,title,body,date,type,photoset_layout,tumblr_id) VALUES(?,?,?,?,?,?,?,?)",
    args: [postId, slug, title, body, date, type, layout, post.id_string],
  });

  // 2. Download media, upload to R2, collect DB insert statements
  let order = 0;
  for (const block of mediaBlocks) {
    const mid = nanoid();
    try {
      if (block.type === "image") {
        const sizes = block.media as Media[];
        if (!sizes?.length) continue;
        const orig =
          sizes.find((m) => m.has_original_dimensions) || sizes[0];
        const ext = extFor(orig.type);
        const rk = `media/${mid}/original.${ext}`;
        const tk = `media/${mid}/thumb.jpg`;

        const buf = await dl(orig.url);
        const tb = await mkThumb(buf, orig.type);
        await r2Put(rk, buf, orig.type);
        await r2Put(tk, tb, "image/jpeg");

        stmts.push({
          sql: "INSERT INTO media(id,post_id,r2_key,thumbnail_r2_key,type,width,height,file_size,display_order,mime_type) VALUES(?,?,?,?,?,?,?,?,?,?)",
          args: [mid, postId, rk, tk, "photo", orig.width, orig.height, buf.length, order++, orig.type],
        });
      } else if (block.type === "video") {
        // Skip external embeds (YouTube, Vimeo, etc.)
        if (block.provider && block.provider !== "tumblr") {
          console.log(
            `    skip external video (${block.provider}): ${block.url}`,
          );
          continue;
        }

        const vm = block.media as unknown as Media;
        if (!vm?.url) continue;

        const rk = `media/${mid}/original.mp4`;
        const tk = `media/${mid}/thumb.jpg`;

        const buf = await dl(vm.url, true);

        // Thumbnail from Tumblr poster frame
        let tb: Buffer;
        if (block.poster?.[0]?.url) {
          const pb = await dl(block.poster[0].url);
          tb = await sharp(pb)
            .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
        } else {
          // Gray placeholder
          tb = await sharp({
            create: {
              width: THUMB_WIDTH,
              height: 225,
              channels: 3,
              background: { r: 30, g: 30, b: 30 },
            },
          })
            .jpeg()
            .toBuffer();
        }

        await r2Put(rk, buf, "video/mp4");
        await r2Put(tk, tb, "image/jpeg");

        stmts.push({
          sql: "INSERT INTO media(id,post_id,r2_key,thumbnail_r2_key,type,width,height,file_size,display_order,mime_type) VALUES(?,?,?,?,?,?,?,?,?,?)",
          args: [mid, postId, rk, tk, "video", vm.width, vm.height, buf.length, order++, "video/mp4"],
        });
      }
    } catch (e) {
      console.error(`    WARN media: ${(e as Error).message}`);
    }
  }

  // 3. Resolve tags/people (creates if needed), collect junction statements
  for (const raw of post.tags) {
    const tag = raw.trim();
    if (!tag) continue;
    const lower = tag.toLowerCase();

    if (PEOPLE.has(lower)) {
      const pid = await ensurePerson(tag);
      stmts.push({
        sql: "INSERT OR IGNORE INTO post_people(post_id,person_id) VALUES(?,?)",
        args: [postId, pid],
      });
    } else {
      const tid = await ensureTag(tag);
      stmts.push({
        sql: "INSERT OR IGNORE INTO post_tags(post_id,tag_id) VALUES(?,?)",
        args: [postId, tid],
      });
    }
  }

  // 4. Execute all DB writes as a transaction
  await getDb().batch(stmts, "write");

  return "ok";
}

// ─── Clean seed data ─────────────────────────────────────────
async function cleanSeedData() {
  console.log("Cleaning seed data...");
  // Delete all posts without a tumblr_id (seed posts don't have one)
  const seeded = await getDb().execute(
    "SELECT COUNT(*) as n FROM posts WHERE tumblr_id IS NULL",
  );
  const count = seeded.rows[0].n as number;
  if (count === 0) {
    console.log("  No seed data found.\n");
    return;
  }
  // CASCADE deletes will clean up media, post_tags, post_people
  await getDb().execute("DELETE FROM posts WHERE tumblr_id IS NULL");
  // Clean up orphaned tags and people with no remaining post references
  await getDb().execute(
    "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM post_tags)",
  );
  await getDb().execute(
    "DELETE FROM people WHERE id NOT IN (SELECT DISTINCT person_id FROM post_people)",
  );
  console.log(`  Deleted ${count} seed posts and cleaned up tags/people.\n`);
}

// ─── CLI ────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const cleanSeed = args.includes("--clean-seed");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1]) : Infinity;
  const offsetArg = args.find((a) => a.startsWith("--offset="));
  const offset = offsetArg ? parseInt(offsetArg.split("=")[1]) : 0;

  console.log("┌─────────────────────────────────────────────┐");
  console.log("│  Tumblr → The Hoecks Migration              │");
  console.log("└─────────────────────────────────────────────┘");
  if (cleanSeed) console.log("  Mode: CLEAN SEED DATA");
  if (dryRun) console.log("  Mode: DRY RUN");
  if (limit < Infinity) console.log(`  Limit: ${limit}`);
  if (offset) console.log(`  Offset: ${offset}`);
  console.log();

  // Clean seed data if requested
  if (cleanSeed) {
    await cleanSeedData();
  }

  // Fetch posts (stop early if limit is set)
  const needed = offset + limit;
  console.log("Fetching posts from Tumblr...");
  let posts = await fetchAll(needed);
  console.log(`Fetched ${posts.length} posts\n`);

  // Apply offset + limit
  posts = posts.slice(offset, offset + limit);
  if (offset || limit < Infinity)
    console.log(`Processing ${posts.length} posts (offset=${offset})\n`);

  // Dry run: list posts and exit
  if (dryRun) {
    for (const [i, p] of posts.entries()) {
      const t = detectType(p.content);
      const mc = p.content.filter(
        (b) => b.type === "image" || b.type === "video",
      ).length;
      console.log(
        `  ${i + 1}. ${p.slug || "(no slug)"} | ${t} | ${mc} media | tags: ${p.tags.join(", ") || "(none)"}`,
      );
    }
    console.log(`\nTotal: ${posts.length} posts`);
    return;
  }

  // Migrate
  console.log("Migrating...\n");
  let ok = 0,
    skip = 0,
    fail = 0;

  for (const [i, p] of posts.entries()) {
    try {
      const result = await migrate(p, i + 1, posts.length);
      if (result === "ok") ok++;
      else if (result === "skip") skip++;
    } catch (e) {
      fail++;
      console.error(`  [${i + 1}] FAIL ${p.slug}: ${(e as Error).message}`);
    }
  }

  console.log();
  console.log("┌─────────────────────────────────────────────┐");
  console.log(
    `│  Done!  migrated: ${ok}  skipped: ${skip}  failed: ${fail}`.padEnd(46) +
      "│",
  );
  console.log("└─────────────────────────────────────────────┘");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
