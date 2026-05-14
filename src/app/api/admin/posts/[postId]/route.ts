import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { downloadFromR2, uploadToR2, deleteFromR2, PUBLIC_URL } from "@/lib/r2";
import { db } from "@/lib/db";

const THUMB_WIDTH = 400;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

async function findOrCreateTag(name: string): Promise<string> {
  const slug = slugify(name);
  const existing = await db.execute({ sql: "SELECT id FROM tags WHERE slug = ?", args: [slug] });
  if (existing.rows.length > 0) return existing.rows[0].id as string;
  const id = nanoid();
  await db.execute({ sql: "INSERT INTO tags (id, name, slug) VALUES (?, ?, ?)", args: [id, name.trim(), slug] });
  return id;
}

async function findOrCreatePerson(name: string): Promise<string> {
  const slug = slugify(name);
  const existing = await db.execute({ sql: "SELECT id FROM people WHERE slug = ?", args: [slug] });
  if (existing.rows.length > 0) return existing.rows[0].id as string;
  const id = nanoid();
  await db.execute({ sql: "INSERT INTO people (id, name, slug) VALUES (?, ?, ?)", args: [id, name.trim(), slug] });
  return id;
}

function generatePhotosetLayout(count: number): string {
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count === 3) return "21";
  if (count === 4) return "22";
  const rows: number[] = [];
  let remaining = count;
  while (remaining > 0) {
    if (remaining >= 5) { rows.push(3); remaining -= 3; }
    else if (remaining === 4) { rows.push(2, 2); remaining = 0; }
    else if (remaining === 3) { rows.push(3); remaining = 0; }
    else if (remaining === 2) { rows.push(2); remaining = 0; }
    else { rows.push(1); remaining = 0; }
  }
  return rows.join("");
}

// ─── GET — return post data for the edit form ──────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const { postId } = await params;

  const postRes = await db.execute({
    sql: "SELECT id, slug, title, body, date, type, photoset_layout FROM posts WHERE id = ?",
    args: [postId],
  });
  if (postRes.rows.length === 0) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  const post = postRes.rows[0];

  const [mediaRes, tagsRes, peopleRes, albumsRes] = await Promise.all([
    db.execute({
      sql: "SELECT id, r2_key, thumbnail_r2_key, type, display_order FROM media WHERE post_id = ? ORDER BY display_order",
      args: [postId],
    }),
    db.execute({
      sql: "SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = ?",
      args: [postId],
    }),
    db.execute({
      sql: "SELECT pe.name FROM post_people pp JOIN people pe ON pe.id = pp.person_id WHERE pp.post_id = ?",
      args: [postId],
    }),
    db.execute({
      sql: "SELECT album_id FROM post_albums WHERE post_id = ?",
      args: [postId],
    }),
  ]);

  const publicUrl = PUBLIC_URL();
  // "2024-01-15 10:30:00" → "2024-01-15T10:30"
  const dateStr = (post.date as string).replace(" ", "T").slice(0, 16);

  return NextResponse.json({
    id: post.id,
    slug: post.slug,
    title: post.title,
    body: post.body,
    date: dateStr,
    type: post.type,
    photoset_layout: post.photoset_layout,
    media: mediaRes.rows.map((m) => ({
      id: m.id,
      r2Key: m.r2_key,
      thumbKey: m.thumbnail_r2_key,
      thumbUrl: m.thumbnail_r2_key
        ? `${publicUrl}/${m.thumbnail_r2_key}`
        : `${publicUrl}/${m.r2_key}`,
      type: m.type,
      displayOrder: m.display_order,
    })),
    tags: tagsRes.rows.map((t) => t.name as string),
    people: peopleRes.rows.map((p) => p.name as string),
    albumIds: albumsRes.rows.map((a) => a.album_id as string),
  });
}

// ─── DELETE — remove post + R2 objects ────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const { postId } = await params;

  try {
    const mediaRes = await db.execute({
      sql: "SELECT r2_key, thumbnail_r2_key FROM media WHERE post_id = ?",
      args: [postId],
    });

    await Promise.all(
      mediaRes.rows.flatMap((m) => [
        m.r2_key ? deleteFromR2(m.r2_key as string).catch(() => {}) : Promise.resolve(),
        m.thumbnail_r2_key ? deleteFromR2(m.thumbnail_r2_key as string).catch(() => {}) : Promise.resolve(),
      ])
    );

    await db.execute({ sql: "DELETE FROM posts_fts WHERE post_id = ?", args: [postId] });

    const result = await db.execute({ sql: "DELETE FROM posts WHERE id = ?", args: [postId] });
    if (result.rowsAffected === 0) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete post error:", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}

// ─── PUT — save edits ─────────────────────────────────────────────────────

interface MediaListItem {
  kind: "existing" | "new";
  mediaId?: string;
  r2Key?: string;
  keyPrefix?: string;
  type?: "photo" | "video";
  posterDataUrl?: string;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const { postId } = await params;

  try {
    const postRes = await db.execute({
      sql: "SELECT id FROM posts WHERE id = ?",
      args: [postId],
    });
    if (postRes.rows.length === 0) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const body = await request.json();
    const title: string | undefined = body.title;
    const dateOverride: string | undefined = body.date;
    const tagNames: string[] = body.tags || [];
    const peopleNames: string[] = body.people || [];
    const albumIds: string[] = body.albumIds || [];
    const mediaList: MediaListItem[] = body.mediaList || [];
    const clientLayout: string | undefined = body.photosetLayout;

    // Current media in DB
    const currentMediaRes = await db.execute({
      sql: "SELECT id, r2_key, thumbnail_r2_key FROM media WHERE post_id = ?",
      args: [postId],
    });
    const currentMediaMap = new Map(
      currentMediaRes.rows.map((m) => [m.id as string, m])
    );

    const keptMediaIds = new Set(
      mediaList
        .filter((item) => item.kind === "existing" && item.mediaId)
        .map((item) => item.mediaId!)
    );

    // Delete removed media from R2 + DB
    for (const [mediaId, media] of currentMediaMap) {
      if (!keptMediaIds.has(mediaId)) {
        await Promise.all([
          media.r2_key ? deleteFromR2(media.r2_key as string).catch(() => {}) : Promise.resolve(),
          media.thumbnail_r2_key ? deleteFromR2(media.thumbnail_r2_key as string).catch(() => {}) : Promise.resolve(),
        ]);
        await db.execute({ sql: "DELETE FROM media WHERE id = ?", args: [mediaId] });
      }
    }

    // Process new media items, keyed by keyPrefix
    const newItemsToProcess = mediaList.filter((item) => item.kind === "new" && item.r2Key && item.keyPrefix);
    const processedNewMap = new Map<string, { id: string; r2Key: string; thumbKey: string; type: "photo" | "video"; width: number; height: number; fileSize: number }>();

    await Promise.all(
      newItemsToProcess.map(async (item) => {
        const mediaId = nanoid();

        if (item.type === "video") {
          let thumbKey = "";
          if (item.posterDataUrl) {
            const base64 = item.posterDataUrl.split(",")[1];
            const posterBuffer = Buffer.from(base64, "base64");
            const thumbBuffer = await sharp(posterBuffer)
              .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
              .jpeg({ quality: 80 })
              .toBuffer();
            thumbKey = `${item.keyPrefix}/thumb.jpg`;
            await uploadToR2(thumbKey, thumbBuffer, "image/jpeg");
          }
          processedNewMap.set(item.keyPrefix!, { id: mediaId, r2Key: item.r2Key!, thumbKey, type: "video", width: 0, height: 0, fileSize: 0 });
          return;
        }

        const buffer = await downloadFromR2(item.r2Key!);
        const [processed, thumbBuffer] = await Promise.all([
          sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true }),
          sharp(buffer).rotate().resize(THUMB_WIDTH, null, { withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(),
        ]);
        const { width, height } = processed.info;
        const originalBuffer = processed.data;
        const processedKey = `${item.keyPrefix}/original.jpg`;
        const thumbKey = `${item.keyPrefix}/thumb.jpg`;
        await Promise.all([
          uploadToR2(processedKey, originalBuffer, "image/jpeg"),
          uploadToR2(thumbKey, thumbBuffer, "image/jpeg"),
        ]);
        processedNewMap.set(item.keyPrefix!, { id: mediaId, r2Key: processedKey, thumbKey, type: "photo", width, height, fileSize: originalBuffer.length });
      })
    );

    // Assign display_order based on mediaList order; insert new media
    let displayOrder = 0;
    for (const item of mediaList) {
      if (item.kind === "existing" && item.mediaId && keptMediaIds.has(item.mediaId)) {
        await db.execute({
          sql: "UPDATE media SET display_order = ? WHERE id = ? AND post_id = ?",
          args: [displayOrder, item.mediaId, postId],
        });
        displayOrder++;
      } else if (item.kind === "new" && item.keyPrefix) {
        const nm = processedNewMap.get(item.keyPrefix);
        if (nm) {
          await db.execute({
            sql: `INSERT INTO media (id, post_id, r2_key, thumbnail_r2_key, type, width, height, file_size, display_order, mime_type)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              nm.id, postId, nm.r2Key, nm.thumbKey || null, nm.type,
              nm.width || null, nm.height || null, nm.fileSize || null,
              displayOrder, nm.type === "video" ? "video/mp4" : "image/jpeg",
            ],
          });
          displayOrder++;
        }
      }
    }

    // Derive post type from final media
    const finalMediaRes = await db.execute({
      sql: "SELECT type FROM media WHERE post_id = ?",
      args: [postId],
    });
    const hasPhotos = finalMediaRes.rows.some((m) => m.type === "photo");
    const hasVideos = finalMediaRes.rows.some((m) => m.type === "video");
    const postType = hasPhotos && hasVideos ? "mixed" : hasVideos ? "video" : "photo";
    const mediaCount = finalMediaRes.rows.length;

    let photosetLayout: string | null = null;
    if (mediaCount > 1) {
      if (clientLayout) {
        const digits = clientLayout.split("").map(Number);
        const sum = digits.reduce((a, b) => a + b, 0);
        photosetLayout = sum === mediaCount && digits.every((d) => d >= 1 && d <= 3)
          ? clientLayout
          : generatePhotosetLayout(mediaCount);
      } else {
        photosetLayout = generatePhotosetLayout(mediaCount);
      }
    }

    // Update post metadata
    const postTitle = title?.trim() ?? null;
    let postDateStr: string | null = null;
    if (dateOverride) {
      const d = new Date(dateOverride);
      if (!isNaN(d.getTime())) {
        postDateStr = d.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
      }
    }

    if (postDateStr) {
      await db.execute({
        sql: "UPDATE posts SET title = ?, date = ?, type = ?, photoset_layout = ?, updated_at = datetime('now') WHERE id = ?",
        args: [postTitle, postDateStr, postType, photosetLayout, postId],
      });
    } else {
      await db.execute({
        sql: "UPDATE posts SET title = ?, type = ?, photoset_layout = ?, updated_at = datetime('now') WHERE id = ?",
        args: [postTitle, postType, photosetLayout, postId],
      });
    }

    // Replace tags, people, albums
    await db.execute({ sql: "DELETE FROM post_tags WHERE post_id = ?", args: [postId] });
    for (const name of tagNames) {
      if (!name.trim()) continue;
      const tagId = await findOrCreateTag(name);
      await db.execute({ sql: "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)", args: [postId, tagId] });
    }

    await db.execute({ sql: "DELETE FROM post_people WHERE post_id = ?", args: [postId] });
    for (const name of peopleNames) {
      if (!name.trim()) continue;
      const personId = await findOrCreatePerson(name);
      await db.execute({ sql: "INSERT OR IGNORE INTO post_people (post_id, person_id) VALUES (?, ?)", args: [postId, personId] });
    }

    await db.execute({ sql: "DELETE FROM post_albums WHERE post_id = ?", args: [postId] });
    for (const albumId of albumIds) {
      if (!albumId.trim()) continue;
      await db.execute({ sql: "INSERT OR IGNORE INTO post_albums (post_id, album_id) VALUES (?, ?)", args: [postId, albumId] });
    }

    // Update FTS
    await db.execute({ sql: "DELETE FROM posts_fts WHERE post_id = ?", args: [postId] });
    await db.execute({
      sql: "INSERT INTO posts_fts(post_id, title, body, tags, people) VALUES (?, ?, '', ?, ?)",
      args: [
        postId,
        postTitle || "",
        tagNames.filter((n) => n.trim()).join(" "),
        peopleNames.filter((n) => n.trim()).join(" "),
      ],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Edit post error:", error);
    return NextResponse.json({ error: "Edit failed" }, { status: 500 });
  }
}
