import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Faces → People ROUTE tests — the DB-touching half that tests/faces.test.ts
 * (pure math) can't see. The risk in this feature lives in the route SQL:
 * which faces get named, which posts get tagged, and what a repeat scan does.
 *
 * Runs against a throwaway local libSQL file. The env is forced BEFORE any
 * handler call and asserted to be a file: URL, so this can never touch a real
 * database. Every test resets the tables so clusters can't bleed between cases.
 * Run: npx tsx --test tests/faces-routes.test.ts
 */

const DB_PATH = join(tmpdir(), `faces-routes-test-${process.pid}.db`);
// Set BEFORE any handler runs. Safe with static imports because src/lib/db.ts
// only reads these inside getDb(), on first actual use — never at import time.
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`;
process.env.TURSO_AUTH_TOKEN = "";
assert.ok(
  process.env.TURSO_DATABASE_URL.startsWith("file:"),
  "refusing to run against a non-file database"
);

import { nanoid } from "nanoid";
import { db } from "../src/lib/db";
import { initializeSchema } from "../src/lib/schema";
import * as scanRoute from "../src/app/api/admin/faces/scan/route";
import * as nameRoute from "../src/app/api/admin/faces/name/route";
import * as matchRoute from "../src/app/api/admin/faces/match/route";
import * as statusRoute from "../src/app/api/admin/faces/status/route";
import * as clustersRoute from "../src/app/api/admin/faces/clusters/route";

const D = 128;
/** Deterministic descriptor; tiny per-seed noise keeps same-base faces together. */
function vec(base: number, seed: number): number[] {
  return Array.from({ length: D }, (_, i) => base + Math.sin(seed * 7.1 + i) * 0.0015);
}
type Req = Parameters<typeof nameRoute.POST>[0];
function post(url: string, body: unknown): Req {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Req;
}
function face(base: number, seed: number, x = 0.1) {
  return { box: { x, y: 0.1, w: 0.2, h: 0.2 }, descriptor: vec(base, seed), score: 0.99 };
}
const count = async (sql: string, args: unknown[] = []) =>
  Number((await db.execute({ sql, args: args as never[] })).rows[0].n);

/** Create a post with `mediaCount` photos. Returns their ids. */
async function seedPost(mediaCount: number): Promise<{ postId: string; mediaIds: string[] }> {
  const postId = nanoid();
  await db.execute({
    sql: `INSERT INTO posts (id, slug, date, type) VALUES (?, ?, '2026-07-04 12:00:00', 'photo')`,
    args: [postId, `faces-test-${postId}`],
  });
  const mediaIds: string[] = [];
  for (let i = 0; i < mediaCount; i++) {
    const id = nanoid();
    mediaIds.push(id);
    await db.execute({
      sql: `INSERT INTO media (id, post_id, r2_key, thumbnail_r2_key, type) VALUES (?, ?, 'media/t/original.jpg', 'media/t/thumb.jpg', 'photo')`,
      args: [id, postId],
    });
  }
  return { postId, mediaIds };
}

const scan = (results: unknown[]) =>
  scanRoute.POST(post("http://t/api/admin/faces/scan", { results }));

before(async () => {
  await initializeSchema();
});

beforeEach(async () => {
  await db.batch(
    [
      "DELETE FROM media_faces",
      "DELETE FROM post_people",
      "DELETE FROM posts_fts",
      "DELETE FROM media",
      "DELETE FROM posts",
      "DELETE FROM people",
    ],
    "write"
  );
});

after(() => {
  try {
    unlinkSync(DB_PATH);
  } catch {
    // best effort
  }
});

describe("scan route", () => {
  it("stores detected faces, marks photos scanned, and drains the queue", async () => {
    const { mediaIds } = await seedPost(2);
    const res = await (
      await scan([
        { mediaId: mediaIds[0], faces: [face(0.1, 1), face(0.9, 2, 0.6)] },
        { mediaId: mediaIds[1], faces: [face(0.1, 3)] },
      ])
    ).json();
    assert.equal(res.faces, 3);
    assert.equal(res.scanned, 2);

    const st = await (await statusRoute.GET()).json();
    assert.equal(st.unnamedFaceCount, 3);
    assert.equal(st.scannedCount, 2);
    assert.equal(st.unscannedCount, 0);
  });

  it("a repeat scan replaces that photo's auto faces instead of duplicating them", async () => {
    const { mediaIds } = await seedPost(1);
    const faces = [face(0.1, 1), face(0.9, 2, 0.6)];
    await scan([{ mediaId: mediaIds[0], faces }]);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM media_faces WHERE media_id = ?`, [mediaIds[0]]), 2);

    await scan([{ mediaId: mediaIds[0], faces }]);
    assert.equal(
      await count(`SELECT COUNT(*) AS n FROM media_faces WHERE media_id = ?`, [mediaIds[0]]),
      2,
      "re-scan must not duplicate auto faces"
    );
  });

  it("drops NaN/Infinity descriptor values rather than poisoning a centroid", async () => {
    const { mediaIds } = await seedPost(1);
    const bad = face(0.1, 1);
    bad.descriptor[7] = NaN;
    const worse = face(0.1, 2);
    worse.descriptor[3] = Infinity;
    const res = await (await scan([{ mediaId: mediaIds[0], faces: [bad, worse] }])).json();
    assert.equal(res.faces, 0);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM media_faces`), 0);
  });
});

describe("name route", () => {
  /** Seed two posts: one with a 2-face cluster to name, one with a different
   *  person that must be left alone. Returns both post ids + the cluster. */
  async function seedTwoPeople() {
    const a = await seedPost(2);
    const b = await seedPost(1);
    await scan([
      { mediaId: a.mediaIds[0], faces: [face(0.1, 1)] },
      { mediaId: a.mediaIds[1], faces: [face(0.1, 3)] },
      { mediaId: b.mediaIds[0], faces: [face(0.9, 5)] },
    ]);
    const cl = await (await clustersRoute.GET()).json();
    assert.equal(cl.clusters.length, 2, "expected one cluster per person");
    const target = cl.clusters[0]; // largest first — the 2-face cluster
    assert.equal(target.faces.length, 2);
    return { a, b, faceIds: target.faces.map((f: { id: string }) => f.id) };
  }

  it("names the cluster, tags only its own posts, and indexes the person for search", async () => {
    const { a, b, faceIds } = await seedTwoPeople();

    const named = await (
      await nameRoute.POST(post("http://t/api/admin/faces/name", { faceIds, personName: "Ada Test" }))
    ).json();
    assert.equal(named.namedFaces, 2);
    assert.equal(named.taggedPosts, 1);

    const tagged = await db.execute({
      sql: `SELECT source FROM post_people WHERE post_id = ?`,
      args: [a.postId],
    });
    assert.equal(tagged.rows.length, 1);
    assert.equal(tagged.rows[0].source, "auto", "face-derived tags stay distinguishable");

    assert.equal(
      await count(`SELECT COUNT(*) AS n FROM post_people WHERE post_id = ?`, [b.postId]),
      0,
      "the other person's post must not be tagged"
    );

    const fts = await db.execute({
      sql: `SELECT people FROM posts_fts WHERE post_id = ?`,
      args: [a.postId],
    });
    assert.ok(String(fts.rows[0].people).includes("Ada Test"));
  });

  it("re-naming already-named faces is a no-op: no new person, no extra post tags", async () => {
    const { faceIds } = await seedTwoPeople();
    await nameRoute.POST(post("http://t/api/admin/faces/name", { faceIds, personName: "Ada Test" }));

    const peopleBefore = await count(`SELECT COUNT(*) AS n FROM people`);
    const tagsBefore = await count(`SELECT COUNT(*) AS n FROM post_people`);

    // A stale review page naming the SAME faces something else.
    const res = await (
      await nameRoute.POST(
        post("http://t/api/admin/faces/name", { faceIds, personName: "Someone Else" })
      )
    ).json();

    assert.equal(res.namedFaces, 0, "already-named faces must not be re-assigned");
    assert.equal(res.taggedPosts, 0);
    assert.equal(
      await count(`SELECT COUNT(*) AS n FROM people`),
      peopleBefore,
      "must not mint a person with no confirmed faces"
    );
    assert.equal(
      await count(`SELECT COUNT(*) AS n FROM post_people`),
      tagsBefore,
      "must not tag posts for a person who owns none of their faces"
    );
  });

  it("reuses an existing person rather than creating a slug-colliding duplicate", async () => {
    const { a } = await (async () => {
      const a = await seedPost(2);
      await scan([
        { mediaId: a.mediaIds[0], faces: [face(0.1, 1)] },
        { mediaId: a.mediaIds[1], faces: [face(0.9, 5)] },
      ]);
      return { a };
    })();

    const cl = await (await clustersRoute.GET()).json();
    assert.equal(cl.clusters.length, 2);
    const [first, second] = cl.clusters.map((c: { faces: { id: string }[] }) =>
      c.faces.map((f) => f.id)
    );

    await nameRoute.POST(post("http://t/api/admin/faces/name", { faceIds: first, personName: "Ada Test" }));
    assert.equal(await count(`SELECT COUNT(*) AS n FROM people`), 1);

    // Same person, different capitalization → same slug → must reuse the row.
    await nameRoute.POST(post("http://t/api/admin/faces/name", { faceIds: second, personName: "ADA TEST" }));
    assert.equal(await count(`SELECT COUNT(*) AS n FROM people`), 1, "no duplicate person row");
    assert.ok(a.postId);
  });

  it("rejects a name that slugifies to nothing", async () => {
    const res = await nameRoute.POST(
      post("http://t/api/admin/faces/name", { faceIds: ["whatever"], personName: "😀🎉" })
    );
    assert.equal(res.status, 400);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM people`), 0);
  });
});

describe("match route", () => {
  async function seedNamedPerson() {
    const a = await seedPost(1);
    await scan([{ mediaId: a.mediaIds[0], faces: [face(0.1, 1)] }]);
    const cl = await (await clustersRoute.GET()).json();
    await nameRoute.POST(
      post("http://t/api/admin/faces/name", {
        faceIds: cl.clusters[0].faces.map((f: { id: string }) => f.id),
        personName: "Ada Test",
      })
    );
  }

  it("suggests a named person for a similar face and nobody for a distant one", async () => {
    await seedNamedPerson();

    const near = await (
      await matchRoute.POST(post("http://t/api/admin/faces/match", { descriptors: [vec(0.1, 99)] }))
    ).json();
    assert.equal(near.people.length, 1);
    assert.equal(near.people[0].name, "Ada Test");

    const far = await (
      await matchRoute.POST(post("http://t/api/admin/faces/match", { descriptors: [vec(0.9, 4)] }))
    ).json();
    assert.equal(far.people.length, 0);
  });

  it("ignores malformed descriptors", async () => {
    await seedNamedPerson();
    const res = await (
      await matchRoute.POST(
        post("http://t/api/admin/faces/match", { descriptors: [[1, 2, 3], "nope", null] })
      )
    ).json();
    assert.equal(res.people.length, 0);
  });

  it("returns nothing when no one has been named yet", async () => {
    const res = await (
      await matchRoute.POST(post("http://t/api/admin/faces/match", { descriptors: [vec(0.1, 1)] }))
    ).json();
    assert.equal(res.people.length, 0);
  });
});
