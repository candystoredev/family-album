import { db } from "./db";

const statements = [
  // Posts
  `CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    title TEXT,
    body TEXT,
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('photo', 'video', 'mixed', 'text')),
    photoset_layout TEXT,
    tumblr_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // Media
  `CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    r2_key TEXT NOT NULL,
    thumbnail_r2_key TEXT,
    type TEXT NOT NULL CHECK(type IN ('photo', 'video')),
    width INTEGER,
    height INTEGER,
    file_size INTEGER,
    duration INTEGER,
    display_order INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT
  )`,

  // Tags
  `CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // Post-Tags junction
  `CREATE TABLE IF NOT EXISTS post_tags (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
  )`,

  // People
  `CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // Post-People junction
  `CREATE TABLE IF NOT EXISTS post_people (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, person_id)
  )`,

  // Albums
  `CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // Post-Albums junction
  `CREATE TABLE IF NOT EXISTS post_albums (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, album_id)
  )`,

  // Post share links (single-post public access, no session granted)
  `CREATE TABLE IF NOT EXISTS post_share_links (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
  )`,

  // Site settings (key-value)
  `CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // Push notification subscriptions — one row per device that opted in.
  // Stores the Web Push subscription, not any personal contact info.
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_success_at TEXT
  )`,

  // Rich media metadata (Phase 10.0) — full extracted payloads, kept verbatim so
  // a future feature never needs a re-scan. One row per (media, extractor/source).
  `CREATE TABLE IF NOT EXISTS media_metadata_raw (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // Origin references for a media item — enables re-sync, audit, and multi-source
  // corroboration during the historical backfill (Phase 10.3).
  `CREATE TABLE IF NOT EXISTS media_sources (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    external_id TEXT,
    content_hash TEXT,
    phash TEXT,
    match_method TEXT,
    match_confidence REAL,
    matched_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_posts_date ON posts(date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug)`,
  `CREATE INDEX IF NOT EXISTS idx_media_post_id ON media(post_id)`,
  `CREATE INDEX IF NOT EXISTS idx_post_tags_tag_id ON post_tags(tag_id)`,
  `CREATE INDEX IF NOT EXISTS idx_post_people_person_id ON post_people(person_id)`,
  `CREATE INDEX IF NOT EXISTS idx_post_albums_album_id ON post_albums(album_id)`,
  `CREATE INDEX IF NOT EXISTS idx_post_share_links_token ON post_share_links(token)`,
  `CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint)`,

  // Rich media metadata (Phase 10.0)
  `CREATE INDEX IF NOT EXISTS idx_media_metadata_raw_media_id ON media_metadata_raw(media_id)`,
  `CREATE INDEX IF NOT EXISTS idx_media_sources_media_id ON media_sources(media_id)`,
  `CREATE INDEX IF NOT EXISTS idx_media_sources_content_hash ON media_sources(content_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_media_sources_phash ON media_sources(phash)`,

];

// Rich media metadata columns (Phase 10.0). All additive/nullable — capture more
// than we model, never overwrite. See docs/rich-metadata-plan.md.
// `duration` already exists on media and is intentionally not repeated here.
const richMediaColumns: ReadonlyArray<readonly [string, string]> = [
  // Time — separate a precise instant (ordering) from a capture-local day (grouping)
  ["taken_at", "TEXT"], // precise capture instant, UTC ISO-8601
  ["tz_offset", "INTEGER"], // capture tz offset, minutes east of UTC
  ["local_date", "TEXT"], // capture-local calendar day, YYYY-MM-DD
  ["date_source", "TEXT"], // exif|exif_offset|video_meta|filename|file_mtime|manual|upload_fallback
  ["date_confidence", "TEXT"], // high|medium|low
  // Place
  ["gps_lat", "REAL"],
  ["gps_lng", "REAL"],
  ["gps_altitude", "REAL"],
  ["place", "TEXT"], // cached reverse-geocode label
  // Device
  ["camera_make", "TEXT"],
  ["camera_model", "TEXT"],
  ["lens", "TEXT"],
  ["iso", "INTEGER"],
  ["aperture", "REAL"],
  ["shutter_speed", "TEXT"],
  ["focal_length", "REAL"],
  // Media characteristics
  ["fps", "REAL"],
  ["codec", "TEXT"],
  ["is_live", "INTEGER"],
  ["is_screenshot", "INTEGER"],
  ["dominant_color", "TEXT"], // hex string
  ["aspect", "REAL"], // width/height
  ["orientation", "INTEGER"],
  // Identity
  ["content_hash", "TEXT"], // SHA-256 of the original bytes
  ["phash", "TEXT"], // perceptual hash, for near-dup + backfill matching
  ["original_filename", "TEXT"],
  // Enrichment (Phase 10.1+/10.5)
  ["caption", "TEXT"],
  ["embedding", "BLOB"], // serialized float vector; vector index added in 10.5
  ["quality_score", "REAL"],
  ["enrichment_status", "TEXT"], // null/none|pending|done|error
  ["enrichment_version", "INTEGER"],
  ["enriched_at", "TEXT"],
  // Provenance
  ["source", "TEXT"], // upload|bulk|tumblr|shared — origin of this media row
];

// Thin rollup on posts for cheap list queries (representative = earliest media).
const richPostColumns: ReadonlyArray<readonly [string, string]> = [
  ["taken_at", "TEXT"], // UTC instant of the representative media
  ["local_date", "TEXT"],
  ["date_source", "TEXT"],
  ["source", "TEXT"], // upload|bulk|tumblr|shared
];

// Auto-derived vs human-curated marker on the junction tables, so regenerated
// auto data never clobbers manual curation.
const sourceTaggedJunctions = ["post_tags", "post_people", "post_albums"] as const;

// Migrations for existing databases (safe to re-run)
const migrations = [
  // Add tumblr_id column if missing (for migration dedup)
  `ALTER TABLE posts ADD COLUMN tumblr_id TEXT`,
  // Drop old external-content FTS5 triggers (tags were always empty)
  `DROP TRIGGER IF EXISTS posts_ai`,
  `DROP TRIGGER IF EXISTS posts_ad`,
  `DROP TRIGGER IF EXISTS posts_au`,
  // Drop old FTS5 table (had wrong schema: external content, no people column)
  `DROP TABLE IF EXISTS posts_fts`,
  // Phase 10.0 — additive rich-metadata columns
  ...richMediaColumns.map(([col, ty]) => `ALTER TABLE media ADD COLUMN ${col} ${ty}`),
  ...richPostColumns.map(([col, ty]) => `ALTER TABLE posts ADD COLUMN ${col} ${ty}`),
  ...sourceTaggedJunctions.map(
    (tbl) => `ALTER TABLE ${tbl} ADD COLUMN source TEXT NOT NULL DEFAULT 'human'`
  ),
  // Phase 11e — share-link revocation (post_share_links only lives in the static
  // `statements` array with no lazy ensure, so already-deployed DBs need this).
  `ALTER TABLE post_share_links ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0`,
];

// Statements that depend on migrations having run first
const postMigrationStatements = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_tumblr_id ON posts(tumblr_id) WHERE tumblr_id IS NOT NULL`,
  // FTS5 virtual table (standalone — synced at application level, not triggers)
  `CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
    post_id UNINDEXED,
    title,
    body,
    tags,
    people
  )`,
  // Phase 10.0 — indexes on the new columns (must run after the ALTERs above)
  `CREATE INDEX IF NOT EXISTS idx_media_taken_at ON media(taken_at)`,
  `CREATE INDEX IF NOT EXISTS idx_media_local_date ON media(local_date)`,
  `CREATE INDEX IF NOT EXISTS idx_media_content_hash ON media(content_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_media_phash ON media(phash)`,
  `CREATE INDEX IF NOT EXISTS idx_media_enrichment_status ON media(enrichment_status)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_taken_at ON posts(taken_at)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_local_date ON posts(local_date)`,
];

/** Input for {@link ftsRowFor} — the raw fields of a single post plus its current tag/person names. */
export interface FtsRowInput {
  title: string | null | undefined;
  body: string | null | undefined;
  tagNames: string[];
  peopleNames: string[];
}

/** A `posts_fts` row's non-key columns, ready to bind into an INSERT. */
export interface FtsRow {
  title: string;
  body: string;
  tags: string;
  people: string;
}

/**
 * Build a `posts_fts` row for a single post, matching {@link rebuildFtsIndex}'s
 * semantics exactly: title/body COALESCE to '', tag/people names space-joined.
 * Used by the incremental insert sites (post create, post edit) so their
 * rows are identical to what a full rebuild would produce — Phase 12c fixed
 * a bug where those sites hardcoded body to '' instead of indexing it.
 */
export function ftsRowFor(input: FtsRowInput): FtsRow {
  return {
    title: input.title ?? "",
    body: input.body ?? "",
    tags: input.tagNames.filter((n) => n.trim()).join(" "),
    people: input.peopleNames.filter((n) => n.trim()).join(" "),
  };
}

/**
 * Rebuild the FTS5 index from scratch.
 * Call after migration, bulk inserts, or when tags/people change.
 */
export async function rebuildFtsIndex() {
  await db.execute(`DELETE FROM posts_fts`);
  await db.execute({
    sql: `INSERT INTO posts_fts(post_id, title, body, tags, people)
          SELECT
            p.id,
            COALESCE(p.title, ''),
            COALESCE(p.body, ''),
            COALESCE((SELECT GROUP_CONCAT(t.name, ' ') FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id), ''),
            COALESCE((SELECT GROUP_CONCAT(pe.name, ' ') FROM post_people pp JOIN people pe ON pe.id = pp.person_id WHERE pp.post_id = p.id), '')
          FROM posts p`,
    args: [],
  });
}

// ─── Cold-start DDL fast path ───────────────────────────────────────────
//
// Each ensure*Schema() below re-runs its full DDL sweep at most once per
// process (guarded by its own module-level `*Ready` boolean) — but a fresh
// serverless cold start means "once per process" can still mean "once per
// request" under low-traffic conditions. `SCHEMA_VERSION` lets an
// already-current database skip the sweep entirely: `initializeSchema()`
// (the /api/init path) stamps `PRAGMA user_version` with this value only
// after a full apply — including `ensureDayShareSchema()`, whose table
// isn't part of the static `statements` list — so every table/column these
// four functions manage is guaranteed to exist once the DB is at version.
//
// A brand-new DB defaults to `user_version = 0`, so ensure*Schema() runs
// its full DDL the first time regardless (0 < SCHEMA_VERSION) — safe even
// if /api/init is never called. An already-deployed prod DB that predates
// this change is also at `user_version = 0`, so it likewise still gets the
// full sweep (and only fast-paths after someone calls /api/init).
const SCHEMA_VERSION = 1;

let cachedUserVersion: number | null = null;

async function isSchemaCurrent(): Promise<boolean> {
  if (cachedUserVersion === null) {
    const result = await db.execute(`PRAGMA user_version`);
    cachedUserVersion = Number(result.rows[0]?.user_version ?? 0);
  }
  return cachedUserVersion >= SCHEMA_VERSION;
}

let pushSchemaReady = false;

/**
 * Lazily ensure the push_subscriptions table exists. Called by the notification
 * endpoints so the feature works on an already-deployed database without having
 * to re-run /api/init. Idempotent and guarded to run at most once per process.
 */
export async function ensurePushSchema() {
  if (pushSchemaReady) return;
  if (await isSchemaCurrent()) {
    pushSchemaReady = true;
    return;
  }
  await db.execute(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_success_at TEXT
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint)`
  );
  pushSchemaReady = true;
}

let dayShareSchemaReady = false;

/**
 * Lazily create the "On this day" share-link table. A token maps to a specific
 * calendar day so a shared /m/<token> link is unguessable and persistent,
 * unlike the date-bearing /today?date= URL.
 */
export async function ensureDayShareSchema() {
  if (dayShareSchemaReady) return;
  if (await isSchemaCurrent()) {
    dayShareSchemaReady = true;
    return;
  }
  await db.execute(`CREATE TABLE IF NOT EXISTS day_share_links (
    token TEXT PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    day INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked INTEGER NOT NULL DEFAULT 0
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_day_share_ymd ON day_share_links(year, month, day)`
  );
  // Phase 11e — revocation column, guarded for tables created before this change.
  try {
    await db.execute(`ALTER TABLE day_share_links ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — safe to ignore
  }
  dayShareSchemaReady = true;
}

let postShareSchemaReady = false;

/**
 * Lazily ensure the `revoked` column exists on post_share_links. The mint route
 * and the public /share/[token] page don't run the full migrations list, so on
 * an already-deployed database the column may be missing without this.
 */
export async function ensurePostShareSchema() {
  if (postShareSchemaReady) return;
  if (await isSchemaCurrent()) {
    postShareSchemaReady = true;
    return;
  }
  try {
    await db.execute(
      `ALTER TABLE post_share_links ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0`
    );
  } catch {
    // Column already exists — safe to ignore
  }
  postShareSchemaReady = true;
}

let richMetadataSchemaReady = false;

/**
 * Lazily ensure the Phase 10.0 rich-metadata schema exists: additive/nullable
 * columns on `media` and `posts`, the `media_metadata_raw` / `media_sources`
 * tables, a `source` marker on the tag/person/album junctions, and supporting
 * indexes. Idempotent — every column ALTER is guarded so re-runs are no-ops,
 * and tables/indexes use IF NOT EXISTS. Called by the upload path so capture
 * (Phase 10.1) works on an already-deployed database without re-running /api/init.
 */
export async function ensureRichMetadataSchema() {
  if (richMetadataSchemaReady) return;
  if (await isSchemaCurrent()) {
    richMetadataSchemaReady = true;
    return;
  }
  await db.execute(`CREATE TABLE IF NOT EXISTS media_metadata_raw (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS media_sources (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    external_id TEXT,
    content_hash TEXT,
    phash TEXT,
    match_method TEXT,
    match_confidence REAL,
    matched_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // ALTER ADD COLUMN throws if the column already exists — guard each one.
  const addColumn = async (sql: string) => {
    try {
      await db.execute(sql);
    } catch {
      // Column already exists — safe to ignore
    }
  };
  for (const [col, ty] of richMediaColumns) {
    await addColumn(`ALTER TABLE media ADD COLUMN ${col} ${ty}`);
  }
  for (const [col, ty] of richPostColumns) {
    await addColumn(`ALTER TABLE posts ADD COLUMN ${col} ${ty}`);
  }
  for (const tbl of sourceTaggedJunctions) {
    await addColumn(`ALTER TABLE ${tbl} ADD COLUMN source TEXT NOT NULL DEFAULT 'human'`);
  }

  for (const sql of [
    `CREATE INDEX IF NOT EXISTS idx_media_metadata_raw_media_id ON media_metadata_raw(media_id)`,
    `CREATE INDEX IF NOT EXISTS idx_media_sources_media_id ON media_sources(media_id)`,
    `CREATE INDEX IF NOT EXISTS idx_media_sources_content_hash ON media_sources(content_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_media_sources_phash ON media_sources(phash)`,
    `CREATE INDEX IF NOT EXISTS idx_media_taken_at ON media(taken_at)`,
    `CREATE INDEX IF NOT EXISTS idx_media_local_date ON media(local_date)`,
    `CREATE INDEX IF NOT EXISTS idx_media_content_hash ON media(content_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_media_phash ON media(phash)`,
    `CREATE INDEX IF NOT EXISTS idx_media_enrichment_status ON media(enrichment_status)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_taken_at ON posts(taken_at)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_local_date ON posts(local_date)`,
  ]) {
    await db.execute(sql);
  }

  richMetadataSchemaReady = true;
}

export async function initializeSchema() {
  for (const sql of statements) {
    await db.execute(sql);
  }
  for (const sql of migrations) {
    try {
      await db.execute(sql);
    } catch {
      // Column/index already exists — safe to ignore
    }
  }
  for (const sql of postMigrationStatements) {
    await db.execute(sql);
  }

  // day_share_links lives only in ensureDayShareSchema(), not in the static
  // `statements` list above — run it here too so a full apply genuinely
  // covers everything the four ensure*Schema() functions manage. That's
  // what makes it safe for them to skip their DDL once `user_version` is
  // current (see the SCHEMA_VERSION comment above).
  await ensureDayShareSchema();

  await db.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  cachedUserVersion = SCHEMA_VERSION;
}
