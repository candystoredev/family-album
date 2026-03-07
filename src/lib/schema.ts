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

  // Invite links
  `CREATE TABLE IF NOT EXISTS invite_links (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    label TEXT,
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

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_posts_date ON posts(date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug)`,
  `CREATE INDEX IF NOT EXISTS idx_media_post_id ON media(post_id)`,
  `CREATE INDEX IF NOT EXISTS idx_post_tags_tag_id ON post_tags(tag_id)`,
  `CREATE INDEX IF NOT EXISTS idx_post_people_person_id ON post_people(person_id)`,
  `CREATE INDEX IF NOT EXISTS idx_post_albums_album_id ON post_albums(album_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invite_links_token ON invite_links(token)`,

  // FTS5 virtual table (external content mode backed by posts rowid)
  `CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
    title,
    body,
    tags,
    content=posts,
    content_rowid=rowid
  )`,

  // FTS5 sync triggers
  `CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
    INSERT INTO posts_fts(rowid, title, body, tags)
    VALUES (new.rowid, new.title, new.body, '');
  END`,

  `CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, title, body, tags)
    VALUES ('delete', old.rowid, old.title, old.body, '');
  END`,

  `CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE ON posts BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, title, body, tags)
    VALUES ('delete', old.rowid, old.title, old.body, '');
    INSERT INTO posts_fts(rowid, title, body, tags)
    VALUES (new.rowid, new.title, new.body, '');
  END`,
];

// Migrations for existing databases (safe to re-run)
const migrations = [
  // Add tumblr_id column if missing (for migration dedup)
  `ALTER TABLE posts ADD COLUMN tumblr_id TEXT`,
];

// Indexes that depend on migrated columns (run after migrations)
const postMigrationStatements = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_tumblr_id ON posts(tumblr_id) WHERE tumblr_id IS NOT NULL`,
];

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
}
