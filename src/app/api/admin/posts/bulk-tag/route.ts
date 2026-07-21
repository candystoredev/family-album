import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { ensureSearchSchema, ftsRowFor } from "@/lib/schema";
import { slugify } from "@/lib/slugify";

const MAX_POSTS = 100;
const MAX_TAGS = 10;

/**
 * Apply one or more tags to many posts at once (feed bulk-select). Admin-gated
 * by middleware (src/middleware.ts) — no in-route auth. Mirrors the tag/FTS
 * handling of the single-post PUT route (../[postId]/route.ts).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const postIds: unknown = body.postIds;
    const tags: unknown = body.tags;

    if (!Array.isArray(postIds) || !Array.isArray(tags)) {
      return NextResponse.json({ error: "postIds and tags are required" }, { status: 400 });
    }

    const cleanPostIds = postIds.filter((id): id is string => typeof id === "string" && id.length > 0);
    const cleanTags = tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean);

    if (cleanPostIds.length === 0 || cleanTags.length === 0) {
      return NextResponse.json({ error: "postIds and tags must be non-empty" }, { status: 400 });
    }
    if (cleanPostIds.length > MAX_POSTS) {
      return NextResponse.json({ error: `Too many posts (max ${MAX_POSTS})` }, { status: 400 });
    }
    if (cleanTags.length > MAX_TAGS) {
      return NextResponse.json({ error: `Too many tags (max ${MAX_TAGS})` }, { status: 400 });
    }

    // Find-or-create each tag by slug — same two-roundtrip idiom as
    // upload/complete: INSERT OR IGNORE, then resolve ids by slug.
    await db.batch(
      cleanTags.map((name) => ({
        sql: "INSERT OR IGNORE INTO tags (id, name, slug) VALUES (?, ?, ?)",
        args: [nanoid(), name, slugify(name)],
      })),
      "write"
    );
    const tagSlugs = [...new Set(cleanTags.map(slugify))];
    const tagRes = await db.execute({
      sql: `SELECT id FROM tags WHERE slug IN (${tagSlugs.map(() => "?").join(",")})`,
      args: tagSlugs,
    });
    const tagIds = tagRes.rows.map((r) => r.id as string);

    // Only tag posts that actually exist.
    const validRes = await db.execute({
      sql: `SELECT id FROM posts WHERE id IN (${cleanPostIds.map(() => "?").join(",")})`,
      args: cleanPostIds,
    });
    const validPostIds = validRes.rows.map((r) => r.id as string);

    if (validPostIds.length === 0) {
      return NextResponse.json({ updated: 0 });
    }

    // Link every (post × tag) pair. source defaults to 'human' (a human applied it).
    await db.batch(
      validPostIds.flatMap((postId) =>
        tagIds.map((tagId) => ({
          sql: "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
          args: [postId, tagId],
        }))
      ),
      "write"
    );

    // Re-index FTS for every affected post so the new tag is instantly
    // searchable — matching what rebuildFtsIndex() produces (real title/body +
    // full tag/people name lists). Read the sources in bulk, then write all the
    // delete+insert statements in one batch. Body/people are read as-is, never
    // wiped to '' (Phase 12c bug — see the single-post PUT route).
    const placeholders = validPostIds.map(() => "?").join(",");
    const [postsRes, tagsRes, peopleRes, placeRes, captionRes] = await Promise.all([
      db.execute({
        sql: `SELECT id, title, body FROM posts WHERE id IN (${placeholders})`,
        args: validPostIds,
      }),
      db.execute({
        sql: `SELECT pt.post_id, t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id IN (${placeholders})`,
        args: validPostIds,
      }),
      db.execute({
        sql: `SELECT pp.post_id, pe.name FROM post_people pp JOIN people pe ON pe.id = pp.person_id WHERE pp.post_id IN (${placeholders})`,
        args: validPostIds,
      }),
      db.execute({
        sql: `SELECT DISTINCT post_id, place FROM media WHERE post_id IN (${placeholders}) AND place IS NOT NULL AND place <> ''`,
        args: validPostIds,
      }),
      db.execute({
        sql: `SELECT post_id, caption FROM media WHERE post_id IN (${placeholders}) AND caption IS NOT NULL AND caption <> ''`,
        args: validPostIds,
      }),
    ]);

    const tagsByPost = new Map<string, string[]>();
    for (const row of tagsRes.rows) {
      const pid = row.post_id as string;
      (tagsByPost.get(pid) ?? tagsByPost.set(pid, []).get(pid)!).push(row.name as string);
    }
    const peopleByPost = new Map<string, string[]>();
    for (const row of peopleRes.rows) {
      const pid = row.post_id as string;
      (peopleByPost.get(pid) ?? peopleByPost.set(pid, []).get(pid)!).push(row.name as string);
    }
    const placesByPost = new Map<string, string[]>();
    for (const row of placeRes.rows) {
      const pid = row.post_id as string;
      (placesByPost.get(pid) ?? placesByPost.set(pid, []).get(pid)!).push(row.place as string);
    }
    const captionsByPost = new Map<string, string[]>();
    for (const row of captionRes.rows) {
      const pid = row.post_id as string;
      (captionsByPost.get(pid) ?? captionsByPost.set(pid, []).get(pid)!).push(row.caption as string);
    }

    const ftsStmts = postsRes.rows.flatMap((p) => {
      const postId = p.id as string;
      const ftsRow = ftsRowFor({
        title: p.title as string | null,
        body: p.body as string | null,
        tagNames: tagsByPost.get(postId) ?? [],
        peopleNames: peopleByPost.get(postId) ?? [],
        placeNames: placesByPost.get(postId) ?? [],
        captions: captionsByPost.get(postId) ?? [],
      });
      return [
        { sql: "DELETE FROM posts_fts WHERE post_id = ?", args: [postId] },
        {
          sql: "INSERT INTO posts_fts(post_id, title, body, tags, people, place, captions) VALUES (?, ?, ?, ?, ?, ?, ?)",
          args: [
            postId,
            ftsRow.title,
            ftsRow.body,
            ftsRow.tags,
            ftsRow.people,
            ftsRow.place,
            ftsRow.captions,
          ],
        },
      ];
    });
    await ensureSearchSchema();
    await db.batch(ftsStmts, "write");

    return NextResponse.json({ updated: validPostIds.length });
  } catch (error) {
    console.error("Bulk-tag error:", error);
    return NextResponse.json({ error: "Bulk tag failed" }, { status: 500 });
  }
}
