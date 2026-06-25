import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// In-memory libSQL for a hermetic DB test. This runs at module-eval time, before
// any test body — and `db` reads the env lazily (inside functions), not at import
// — so the singleton picks this up on its first use in before().
process.env.TURSO_DATABASE_URL = ":memory:";

import { initializeSchema } from "../src/lib/schema";
import { db } from "../src/lib/db";
import { ORDER_KEY_SQL, EFF_DAY_SQL } from "../src/lib/order";

/**
 * Phase 10.2a — feed ordering + cursor pagination over the effective order key
 * (taken_at ?? normalized legacy date). Guards two invariants the family's feed
 * depends on: existing posts keep their exact order, and cursor pagination has
 * no duplicates or skips across the legacy date-format boundary.
 * Run: npx tsx --test tests/feed-order.test.ts
 */

const ORDER = `${ORDER_KEY_SQL} AS order_key`;

async function insert(id: string, date: string, takenAt: string | null) {
  await db.execute({
    sql: `INSERT INTO posts (id, slug, title, date, type, taken_at, local_date)
          VALUES (?, ?, ?, ?, 'photo', ?, ?)`,
    args: [id, "s-" + id, id, date, takenAt, takenAt ? takenAt.slice(0, 10) : null],
  });
}

async function paginate(pageSize: number): Promise<string[]> {
  const seq: string[] = [];
  let cursor: { k: string; id: string } | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const where: string = cursor
      ? `WHERE (${ORDER_KEY_SQL} < ? OR (${ORDER_KEY_SQL} = ? AND p.id < ?))`
      : "";
    const args: (string | number)[] = cursor
      ? [cursor.k, cursor.k, cursor.id, pageSize + 1]
      : [pageSize + 1];
    const r = await db.execute({
      sql: `SELECT p.id, ${ORDER} FROM posts p ${where} ORDER BY order_key DESC, p.id DESC LIMIT ?`,
      args,
    });
    let rows = r.rows;
    const more = rows.length > pageSize;
    if (more) rows = rows.slice(0, pageSize);
    if (rows.length === 0) break;
    rows.forEach((row) => seq.push(row.id as string));
    if (!more) break;
    const last = rows[rows.length - 1];
    cursor = { k: last.order_key as string, id: last.id as string };
  }
  return seq;
}

describe("feed ordering (Phase 10.2a)", () => {
  before(async () => {
    await initializeSchema();
    await db.execute("DELETE FROM posts");
    // Migrated posts are old (T…Z form); uploads are recent (space, no Z).
    await insert("A_2012", "2012-09-11T04:00:00.000Z", null);
    await insert("A2_2015", "2015-03-20T18:00:00.000Z", null);
    await insert("B_2026may", "2026-05-01 10:00:00.000", null);
    await insert("C_2026jun25", "2026-06-25 14:00:56.000", null);
    // Legacy date says Jun 25 but true capture is Jun 23 → must reorder earlier.
    await insert("D_takenJun23", "2026-06-25 13:40:53.794", "2026-06-23T18:37:10.000Z");
  });

  const expected = ["C_2026jun25", "D_takenJun23", "B_2026may", "A2_2015", "A_2012"];

  it("orders by the effective key (taken_at repositions a mis-dated post)", async () => {
    const r = await db.execute(
      `SELECT p.id, ${ORDER} FROM posts p ORDER BY order_key DESC, p.id DESC`
    );
    assert.deepEqual(r.rows.map((x) => x.id), expected);
  });

  it("preserves the existing order of legacy (no taken_at) posts", async () => {
    const newOrder = (
      await db.execute(`SELECT p.id, ${ORDER} FROM posts p ORDER BY order_key DESC, p.id DESC`)
    ).rows
      .map((x) => x.id as string)
      .filter((id) => id !== "D_takenJun23");
    const oldOrder = (
      await db.execute(`SELECT id FROM posts WHERE taken_at IS NULL ORDER BY date DESC, id DESC`)
    ).rows.map((x) => x.id as string);
    assert.deepEqual(newOrder, oldOrder);
  });

  it("paginates with no dupes or skips (small page across the format boundary)", async () => {
    const paged = await paginate(2);
    assert.deepEqual(paged, expected);
    assert.equal(new Set(paged).size, paged.length);
  });

  it("groups by effective day: local_date when present, else legacy day (10.2b)", async () => {
    const r = await db.execute(
      `SELECT p.id, substr(${EFF_DAY_SQL},1,4) AS y, substr(${EFF_DAY_SQL},6,2) AS m, substr(${EFF_DAY_SQL},9,2) AS d FROM posts p`
    );
    const by = new Map(r.rows.map((x) => [x.id as string, `${x.y}-${x.m}-${x.d}`]));
    // D has local_date 2026-06-23 though its legacy date is Jun 25 → groups to the 23rd.
    assert.equal(by.get("D_takenJun23"), "2026-06-23");
    // A legacy post (no local_date) groups by its own date's day.
    assert.equal(by.get("A_2012"), "2012-09-11");
  });
});
