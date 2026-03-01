import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { nanoid } from "nanoid";

/**
 * Cursor-based pagination test (Phase 4a).
 * Exercises: 50+ posts, same-timestamp posts, correct ordering, no dupes, no skips.
 *
 * Run: npx tsx --test tests/cursor-pagination.test.ts
 */

const PAGE_SIZE = 20;

function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { date: string; id: string } {
  const decoded = Buffer.from(cursor, "base64url").toString();
  const sep = decoded.indexOf("|");
  return { date: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
}

describe("cursor-based pagination", () => {
  const db = createClient({ url: "file::memory:" });

  // Generate 60 posts: 50 with unique dates + 10 sharing the same timestamp
  const allPosts: { id: string; date: string }[] = [];

  before(async () => {
    await db.execute(`
      CREATE TABLE posts (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        title TEXT,
        body TEXT,
        date TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'photo',
        photoset_layout TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await db.execute("CREATE INDEX idx_posts_date ON posts(date DESC)");

    // 50 posts with unique dates (one per day in Jan 2024)
    for (let i = 1; i <= 50; i++) {
      const day = String(i).padStart(2, "0");
      // Days 1–31 in Jan, then wrap to Feb for 32–50
      const month = i <= 31 ? "01" : "02";
      const d = i <= 31 ? day : String(i - 31).padStart(2, "0");
      const date = `2024-${month}-${d}T12:00:00.000Z`;
      const id = nanoid();
      allPosts.push({ id, date });
      await db.execute({
        sql: "INSERT INTO posts (id, slug, title, date, type) VALUES (?, ?, ?, ?, ?)",
        args: [id, `post-${i}`, `Post ${i}`, date, "photo"],
      });
    }

    // 10 posts all sharing the same timestamp
    const sameDate = "2024-03-01T12:00:00.000Z";
    for (let i = 51; i <= 60; i++) {
      const id = nanoid();
      allPosts.push({ id, date: sameDate });
      await db.execute({
        sql: "INSERT INTO posts (id, slug, title, date, type) VALUES (?, ?, ?, ?, ?)",
        args: [id, `post-${i}`, `Same-date post ${i}`, sameDate, "photo"],
      });
    }

    // Sort allPosts in expected order: date DESC, id DESC
    allPosts.sort((a, b) => {
      if (a.date > b.date) return -1;
      if (a.date < b.date) return 1;
      if (a.id > b.id) return -1;
      if (a.id < b.id) return 1;
      return 0;
    });
  });

  async function fetchPage(cursor: string | null) {
    let result;
    if (cursor) {
      const parsed = decodeCursor(cursor);
      result = await db.execute({
        sql: `SELECT id, date FROM posts
              WHERE date < ? OR (date = ? AND id < ?)
              ORDER BY date DESC, id DESC LIMIT ?`,
        args: [parsed.date, parsed.date, parsed.id, PAGE_SIZE + 1],
      });
    } else {
      result = await db.execute({
        sql: "SELECT id, date FROM posts ORDER BY date DESC, id DESC LIMIT ?",
        args: [PAGE_SIZE + 1],
      });
    }

    const rows = result.rows as unknown as { id: string; date: string }[];
    let nextCursor: string | null = null;
    const page = rows.length > PAGE_SIZE ? rows.slice(0, PAGE_SIZE) : rows;
    if (rows.length > PAGE_SIZE) {
      const last = page[page.length - 1];
      nextCursor = encodeCursor(last.date, last.id);
    }
    return { page, nextCursor };
  }

  it("returns all 60 posts across pages with no dupes and no skips", async () => {
    const seen = new Set<string>();
    const order: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const { page, nextCursor } = await fetchPage(cursor);
      for (const row of page) {
        assert.ok(!seen.has(row.id), `Duplicate post: ${row.id}`);
        seen.add(row.id);
        order.push(row.id);
      }
      cursor = nextCursor;
      pages++;
    } while (cursor);

    assert.equal(seen.size, 60, `Expected 60 posts, got ${seen.size}`);
    assert.equal(pages, 3, "Expected 3 pages (20 + 20 + 20)");
  });

  it("maintains correct ordering (date DESC, id DESC)", async () => {
    const order: { id: string; date: string }[] = [];
    let cursor: string | null = null;

    do {
      const { page, nextCursor } = await fetchPage(cursor);
      order.push(...page);
      cursor = nextCursor;
    } while (cursor);

    // Verify order matches the pre-sorted allPosts
    assert.equal(order.length, allPosts.length);
    for (let i = 0; i < order.length; i++) {
      assert.equal(order[i].id, allPosts[i].id, `Mismatch at index ${i}`);
    }
  });

  it("correctly paginates through same-timestamp posts", async () => {
    const sameDate = "2024-03-01T12:00:00.000Z";
    const sameDatePosts = allPosts.filter((p) => p.date === sameDate);

    // All 10 same-date posts should appear in order
    const order: { id: string; date: string }[] = [];
    let cursor: string | null = null;
    do {
      const { page, nextCursor } = await fetchPage(cursor);
      order.push(...page);
      cursor = nextCursor;
    } while (cursor);

    const sameDateInResult = order.filter((p) => p.date === sameDate);
    assert.equal(sameDateInResult.length, 10, "All 10 same-date posts present");

    // Verify they appear in id DESC order
    for (let i = 1; i < sameDateInResult.length; i++) {
      assert.ok(
        sameDateInResult[i - 1].id > sameDateInResult[i].id,
        `Same-date posts not in id DESC order at index ${i}`
      );
    }
  });

  it("returns null cursor on last page", async () => {
    // Skip to the last page
    let cursor: string | null = null;
    let lastNextCursor: string | null = "not-null";

    do {
      const { nextCursor } = await fetchPage(cursor);
      lastNextCursor = nextCursor;
      if (nextCursor) cursor = nextCursor;
      else break;
    } while (true);

    assert.equal(lastNextCursor, null, "Last page should have null nextCursor");
  });

  it("handles invalid cursor gracefully", () => {
    assert.doesNotThrow(() => {
      const result = decodeCursor("not-valid-base64");
      // Should parse without crashing (may return garbage but won't throw)
      assert.ok(result);
    });
  });

  it("cursor encode/decode roundtrip", () => {
    const date = "2024-01-15T12:00:00.000Z";
    const id = "abc123xyz";
    const cursor = encodeCursor(date, id);
    const decoded = decodeCursor(cursor);
    assert.equal(decoded.date, date);
    assert.equal(decoded.id, id);
  });
});
