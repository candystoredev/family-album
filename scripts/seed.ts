#!/usr/bin/env tsx
/**
 * Local test-data seeder — creates test posts with generated photos in R2.
 *
 * Previously this lived as POST /api/seed plus a "Seed test data" button
 * shown to admins on the home page. /api/seed was always blocked in
 * production, so the button just 403'd there while still shipping ~550
 * lines of test-fixture code in the prod bundle. Phase 13b removed both and
 * moved the generation logic here so seeding a local/dev database is still
 * possible.
 *
 * Usage:
 *   npx tsx scripts/seed.ts              # create the 25 test posts (skips titles that already exist)
 *   npx tsx scripts/seed.ts --dedupe     # remove duplicate posts, keep the newest per title
 *   npx tsx scripts/seed.ts --clean      # delete ALL seed posts (by known title) + their R2 media
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import sharp from "sharp";

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
const BUCKET = () => process.env.R2_BUCKET_NAME || "thehoecks-media";
const PUBLIC_URL = () => (process.env.R2_PUBLIC_URL || "").replace(/\/+$/, "");

async function r2Put(key: string, body: Buffer, contentType: string) {
  await getR2().send(
    new PutObjectCommand({ Bucket: BUCKET(), Key: key, Body: body, ContentType: contentType }),
  );
}

async function r2Delete(key: string) {
  await getR2().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }));
}

// ─── Seed post definitions ───────────────────────────────────
// 25 test posts spanning 2023-2025, mix of single photos and photosets.
const testPosts = [
  {
    title: "New Year's Day Hike",
    slug: "new-years-day-hike",
    body: "Starting the year off right with a hike up the mountain.",
    date: "2025-01-01T10:00:00Z",
    type: "photo" as const,
    color: { r: 80, g: 120, b: 80 },
    mediaCount: 1,
  },
  {
    title: "Christmas Morning",
    slug: "christmas-morning-2024",
    body: "The kids were up at 5am. Worth it.",
    date: "2024-12-25T08:15:00Z",
    type: "photo" as const,
    color: { r: 180, g: 40, b: 40 },
    mediaCount: 4,
    photosetLayout: "22",
  },
  {
    title: "Happy Steaksgiving",
    slug: "happy-steaksgiving",
    body: "We'll do the real one Saturday",
    date: "2024-11-23T18:00:00Z",
    type: "photo" as const,
    color: { r: 160, g: 80, b: 40 },
    mediaCount: 3,
    photosetLayout: "21",
  },
  {
    title: "Fall Colors",
    slug: "fall-colors",
    body: "The backyard is putting on a show this year.",
    date: "2024-10-19T16:00:00Z",
    type: "photo" as const,
    color: { r: 190, g: 120, b: 30 },
    mediaCount: 2,
    photosetLayout: "2",
  },
  {
    title: "Halloween Costumes",
    slug: "halloween-2024",
    body: null,
    date: "2024-10-31T19:30:00Z",
    type: "photo" as const,
    color: { r: 140, g: 80, b: 160 },
    mediaCount: 3,
    photosetLayout: "12",
  },
  {
    title: "First Day of School",
    slug: "first-day-of-school-2024",
    body: null,
    date: "2024-08-19T07:45:00Z",
    type: "photo" as const,
    color: { r: 60, g: 140, b: 60 },
    mediaCount: 1,
  },
  {
    title: "Summer Vacation",
    slug: "summer-vacation-2024",
    body: "Two weeks at the lake. The kids didn't want to leave.",
    date: "2024-07-28T12:00:00Z",
    type: "photo" as const,
    color: { r: 30, g: 150, b: 200 },
    mediaCount: 5,
    photosetLayout: "212",
  },
  {
    title: "Beach Day",
    slug: "beach-day",
    body: "Perfect weather for the beach today!",
    date: "2024-07-15T14:30:00Z",
    type: "photo" as const,
    color: { r: 30, g: 130, b: 180 },
    mediaCount: 1,
  },
  {
    title: "Fourth of July",
    slug: "fourth-of-july-2024",
    body: "Fireworks from the rooftop. Best seats in town.",
    date: "2024-07-04T21:00:00Z",
    type: "photo" as const,
    color: { r: 20, g: 30, b: 100 },
    mediaCount: 2,
    photosetLayout: "11",
  },
  {
    title: "Father's Day Breakfast",
    slug: "fathers-day-2024",
    body: "They made pancakes shaped like hearts. Close enough.",
    date: "2024-06-16T09:00:00Z",
    type: "photo" as const,
    color: { r: 180, g: 160, b: 100 },
    mediaCount: 1,
  },
  {
    title: "End of the School Year",
    slug: "end-of-school-2024",
    body: "Made it through another one. Summer time.",
    date: "2024-06-07T15:30:00Z",
    type: "photo" as const,
    color: { r: 255, g: 200, b: 50 },
    mediaCount: 1,
  },
  {
    title: "Mother's Day",
    slug: "mothers-day-2024",
    body: "She deserves the world.",
    date: "2024-05-12T11:00:00Z",
    type: "photo" as const,
    color: { r: 200, g: 100, b: 150 },
    mediaCount: 2,
    photosetLayout: "11",
  },
  {
    title: "Spring Garden",
    slug: "spring-garden-2024",
    body: "Everything is blooming. The tulips came in strong this year.",
    date: "2024-04-20T10:00:00Z",
    type: "photo" as const,
    color: { r: 100, g: 180, b: 80 },
    mediaCount: 3,
    photosetLayout: "21",
  },
  {
    title: "Easter Egg Hunt",
    slug: "easter-2024",
    body: null,
    date: "2024-03-31T11:00:00Z",
    type: "photo" as const,
    color: { r: 180, g: 220, b: 130 },
    mediaCount: 4,
    photosetLayout: "22",
  },
  {
    title: "Snow Day",
    slug: "snow-day-2024",
    body: "School's canceled. Snowman building competition in full swing.",
    date: "2024-02-10T09:00:00Z",
    type: "photo" as const,
    color: { r: 180, g: 200, b: 220 },
    mediaCount: 1,
  },
  {
    title: "Valentine's Day Dinner",
    slug: "valentines-2024",
    body: "Cooked at home this year. Way better than a restaurant.",
    date: "2024-02-14T19:30:00Z",
    type: "photo" as const,
    color: { r: 180, g: 50, b: 80 },
    mediaCount: 1,
  },
  {
    title: "Super Bowl Sunday",
    slug: "super-bowl-2024",
    body: "We don't care who wins, we're here for the food.",
    date: "2024-02-11T17:00:00Z",
    type: "photo" as const,
    color: { r: 50, g: 80, b: 50 },
    mediaCount: 2,
    photosetLayout: "2",
  },
  {
    title: "New Year's Eve",
    slug: "new-years-eve-2023",
    body: "Made it to midnight. Barely.",
    date: "2023-12-31T23:59:00Z",
    type: "photo" as const,
    color: { r: 30, g: 30, b: 60 },
    mediaCount: 1,
  },
  {
    title: "Christmas Cookie Decorating",
    slug: "christmas-cookies-2023",
    body: "The kids went wild with the sprinkles.",
    date: "2023-12-23T14:00:00Z",
    type: "photo" as const,
    color: { r: 60, g: 120, b: 60 },
    mediaCount: 3,
    photosetLayout: "12",
  },
  {
    title: "Thanksgiving Table",
    slug: "thanksgiving-2023",
    body: "Full house this year. Grateful for all of it.",
    date: "2023-11-23T16:00:00Z",
    type: "photo" as const,
    color: { r: 140, g: 100, b: 50 },
    mediaCount: 1,
  },
  {
    title: "Pumpkin Patch",
    slug: "pumpkin-patch-2023",
    body: null,
    date: "2023-10-14T11:00:00Z",
    type: "photo" as const,
    color: { r: 200, g: 120, b: 30 },
    mediaCount: 4,
    photosetLayout: "211",
  },
  {
    title: "Back to School 2023",
    slug: "back-to-school-2023",
    body: "New backpacks, new shoes, new year.",
    date: "2023-08-21T07:30:00Z",
    type: "photo" as const,
    color: { r: 70, g: 130, b: 180 },
    mediaCount: 2,
    photosetLayout: "11",
  },
  {
    title: "Summer BBQ",
    slug: "summer-bbq-2023",
    body: "Neighbors came over. Burgers, hot dogs, the works.",
    date: "2023-07-22T17:00:00Z",
    type: "photo" as const,
    color: { r: 180, g: 80, b: 30 },
    mediaCount: 1,
  },
  {
    title: "Family Road Trip",
    slug: "road-trip-2023",
    body: "12 hours in the car. 400 rounds of I Spy. No regrets.",
    date: "2023-06-15T08:00:00Z",
    type: "photo" as const,
    color: { r: 100, g: 140, b: 180 },
    mediaCount: 5,
    photosetLayout: "221",
  },
  {
    title: "Birthday Party",
    slug: "birthday-2023",
    body: "Another trip around the sun.",
    date: "2023-05-10T14:00:00Z",
    type: "photo" as const,
    color: { r: 200, g: 150, b: 50 },
    mediaCount: 3,
    photosetLayout: "21",
  },
];

// Derived (not hand-duplicated) so --clean can never drift from testPosts.
const SEED_TITLES = testPosts.map((p) => p.title);

/** Generate a simple colored JPEG with text overlay via sharp */
async function generateTestImage(
  label: string,
  color: { r: number; g: number; b: number },
  width = 1200,
  height = 800,
): Promise<{ original: Buffer; thumbnail: Buffer }> {
  const svg = `<svg width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="rgb(${color.r},${color.g},${color.b})" />
    <rect width="100%" height="100%" fill="url(#grad)" />
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:rgba(255,255,255,0.15)" />
        <stop offset="100%" style="stop-color:rgba(0,0,0,0.3)" />
      </linearGradient>
    </defs>
    <text x="50%" y="45%" text-anchor="middle" font-family="sans-serif"
          font-size="48" fill="white" font-weight="bold">${label}</text>
    <text x="50%" y="58%" text-anchor="middle" font-family="sans-serif"
          font-size="24" fill="rgba(255,255,255,0.7)">The Hoecks — Test Image</text>
  </svg>`;

  const original = await sharp(Buffer.from(svg))
    .resize(width, height)
    .jpeg({ quality: 85 })
    .toBuffer();

  const thumbnail = await sharp(original)
    .resize(600, 400, { fit: "cover" })
    .jpeg({ quality: 75 })
    .toBuffer();

  return { original, thumbnail };
}

// ─── Seed ─────────────────────────────────────────────────────
async function seed() {
  let created = 0;
  let skipped = 0;

  for (const post of testPosts) {
    const existing = await getDb().execute({
      sql: `SELECT id FROM posts WHERE title = ? LIMIT 1`,
      args: [post.title],
    });
    if (existing.rows.length > 0) {
      skipped++;
      continue;
    }

    const postId = nanoid();
    const slug = `${post.slug}-${nanoid(6)}`;

    await getDb().execute({
      sql: `INSERT INTO posts (id, slug, title, body, date, type, photoset_layout)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [postId, slug, post.title, post.body, post.date, post.type, post.photosetLayout ?? null],
    });

    for (let i = 0; i < post.mediaCount; i++) {
      const mediaId = nanoid();
      const label = post.mediaCount > 1 ? `${post.title} (${i + 1}/${post.mediaCount})` : post.title;

      // Vary color slightly for multi-photo posts
      const color = {
        r: Math.min(255, post.color.r + i * 20),
        g: Math.min(255, post.color.g + i * 15),
        b: Math.min(255, post.color.b + i * 10),
      };

      const { original, thumbnail } = await generateTestImage(label, color);

      const r2Key = `media/${mediaId}/original.jpg`;
      const thumbKey = `media/${mediaId}/thumb.jpg`;

      await r2Put(r2Key, original, "image/jpeg");
      await r2Put(thumbKey, thumbnail, "image/jpeg");

      await getDb().execute({
        sql: `INSERT INTO media (id, post_id, r2_key, thumbnail_r2_key, type, width, height, file_size, display_order, mime_type)
              VALUES (?, ?, ?, ?, 'photo', 1200, 800, ?, ?, 'image/jpeg')`,
        args: [mediaId, postId, r2Key, thumbKey, original.length, i],
      });
    }

    console.log(`  created ${slug} (${post.mediaCount} media)${PUBLIC_URL() ? ` — ${PUBLIC_URL()}/media` : ""}`);
    created++;
  }

  console.log(`\nSeeded ${created} test posts${skipped > 0 ? ` (skipped ${skipped} existing)` : ""}`);
}

// ─── Dedupe (keeps newest per title) ───────────────────────────
async function dedupe() {
  const dupes = await getDb().execute(
    `SELECT title, COUNT(*) as cnt FROM posts WHERE title IS NOT NULL GROUP BY title HAVING cnt > 1`,
  );

  let deleted = 0;
  for (const row of dupes.rows) {
    const title = row.title as string;
    const posts = await getDb().execute({
      sql: `SELECT id FROM posts WHERE title = ? ORDER BY created_at DESC, id DESC`,
      args: [title],
    });
    const idsToDelete = posts.rows.slice(1).map((r) => r.id as string);
    for (const id of idsToDelete) {
      await getDb().execute({ sql: `DELETE FROM posts WHERE id = ?`, args: [id] });
      deleted++;
    }
  }

  console.log(`Removed ${deleted} duplicate posts across ${dupes.rows.length} titles`);
}

// ─── Clean (delete all seed posts by known title + their R2 media) ────
async function clean() {
  let deletedPosts = 0;
  let deletedMedia = 0;
  let deletedR2 = 0;

  for (const title of SEED_TITLES) {
    const posts = await getDb().execute({
      sql: `SELECT id FROM posts WHERE title = ?`,
      args: [title],
    });

    for (const post of posts.rows) {
      const postId = post.id as string;

      const media = await getDb().execute({
        sql: `SELECT r2_key, thumbnail_r2_key FROM media WHERE post_id = ?`,
        args: [postId],
      });

      for (const m of media.rows) {
        const r2Key = m.r2_key as string;
        const thumbKey = m.thumbnail_r2_key as string | null;
        try {
          await r2Delete(r2Key);
          deletedR2++;
          if (thumbKey) {
            await r2Delete(thumbKey);
            deletedR2++;
          }
        } catch (e) {
          console.warn(`  R2 delete failed for ${r2Key}:`, e);
        }
      }

      deletedMedia += media.rows.length;

      // Media cascade-deletes via FK
      await getDb().execute({ sql: `DELETE FROM posts WHERE id = ?`, args: [postId] });
      deletedPosts++;
    }
  }

  console.log(`Cleaned ${deletedPosts} seed posts, ${deletedMedia} media records, ${deletedR2} R2 objects`);
}

// ─── CLI ────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  console.log("┌─────────────────────────────────────────────┐");
  console.log("│  The Hoecks — local test-data seeder         │");
  console.log("└─────────────────────────────────────────────┘");

  if (args.includes("--clean")) {
    console.log("  Mode: CLEAN (delete all seed posts + media)\n");
    return clean();
  }
  if (args.includes("--dedupe")) {
    console.log("  Mode: DEDUPE (remove duplicate posts)\n");
    return dedupe();
  }
  console.log("  Mode: SEED\n");
  return seed();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
