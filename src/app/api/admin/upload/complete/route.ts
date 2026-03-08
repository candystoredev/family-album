import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { downloadFromR2, uploadToR2 } from "@/lib/r2";
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

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let suffix = 1;
  while (true) {
    const existing = await db.execute({
      sql: "SELECT 1 FROM posts WHERE slug = ?",
      args: [slug],
    });
    if (existing.rows.length === 0) return slug;
    suffix++;
    slug = `${base}-${suffix}`;
  }
}

async function extractExifDate(buffer: Buffer): Promise<Date | null> {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.exif) return null;

    const exifStr = metadata.exif.toString("binary");
    const dateMatch = exifStr.match(
      /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/
    );
    if (dateMatch) {
      const [, yr, mo, dy, hr, mi, sc] = dateMatch;
      const d = new Date(`${yr}-${mo}-${dy}T${hr}:${mi}:${sc}`);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  } catch {
    return null;
  }
}

async function findOrCreateTag(name: string): Promise<string> {
  const slug = slugify(name);
  const existing = await db.execute({
    sql: "SELECT id FROM tags WHERE slug = ?",
    args: [slug],
  });
  if (existing.rows.length > 0) return existing.rows[0].id as string;

  const id = nanoid();
  await db.execute({
    sql: "INSERT INTO tags (id, name, slug) VALUES (?, ?, ?)",
    args: [id, name.trim(), slug],
  });
  return id;
}

async function findOrCreatePerson(name: string): Promise<string> {
  const slug = slugify(name);
  const existing = await db.execute({
    sql: "SELECT id FROM people WHERE slug = ?",
    args: [slug],
  });
  if (existing.rows.length > 0) return existing.rows[0].id as string;

  const id = nanoid();
  await db.execute({
    sql: "INSERT INTO people (id, name, slug) VALUES (?, ?, ?)",
    args: [id, name.trim(), slug],
  });
  return id;
}

interface MediaItem {
  r2Key: string;
  keyPrefix: string;
  type: "photo" | "video";
  posterDataUrl?: string; // base64 data URL for video poster frame
}

/**
 * Complete the upload: process images/videos, create post + media + tag/people/album records.
 *
 * Client sends: {
 *   items: MediaItem[],
 *   title?: string,
 *   date?: string,
 *   tags?: string[],
 *   people?: string[],
 *   albumIds?: string[],
 * }
 *
 * Also supports legacy single-file format: { r2Key, keyPrefix, title?, date? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Support legacy single-file format from 5a
    const items: MediaItem[] = body.items || [
      { r2Key: body.r2Key, keyPrefix: body.keyPrefix, type: "photo" as const },
    ];
    const title: string | undefined = body.title;
    const dateOverride: string | undefined = body.date;
    const tagNames: string[] = body.tags || [];
    const peopleNames: string[] = body.people || [];
    const albumIds: string[] = body.albumIds || [];

    if (items.length === 0 || !items[0].r2Key) {
      return NextResponse.json(
        { error: "No media items provided" },
        { status: 400 }
      );
    }

    // Process each media item
    let firstExifDate: Date | null = null;
    const mediaRecords: {
      id: string;
      r2Key: string;
      thumbKey: string;
      type: "photo" | "video";
      width: number;
      height: number;
      fileSize: number;
      displayOrder: number;
    }[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const mediaId = nanoid();

      if (item.type === "video") {
        // For videos: store as-is, use client-provided poster as thumbnail
        const processedKey = item.r2Key; // keep original video file
        let thumbKey = "";

        if (item.posterDataUrl) {
          // Decode base64 poster frame from client
          const base64 = item.posterDataUrl.split(",")[1];
          const posterBuffer = Buffer.from(base64, "base64");

          // Process poster through sharp for consistent thumbnail
          const thumbBuffer = await sharp(posterBuffer)
            .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

          thumbKey = `${item.keyPrefix}/thumb.jpg`;
          await uploadToR2(thumbKey, thumbBuffer, "image/jpeg");
        }

        mediaRecords.push({
          id: mediaId,
          r2Key: processedKey,
          thumbKey,
          type: "video",
          width: 0,
          height: 0,
          fileSize: 0,
          displayOrder: i,
        });
      } else {
        // Photo: download, extract EXIF, process, thumbnail
        const buffer = await downloadFromR2(item.r2Key);

        // Extract EXIF date from first photo
        if (i === 0 || !firstExifDate) {
          const exif = await extractExifDate(buffer);
          if (exif && !firstExifDate) firstExifDate = exif;
        }

        // Process image: auto-rotate, convert to JPEG, get dimensions
        const processed = await sharp(buffer)
          .rotate()
          .jpeg({ quality: 90 })
          .toBuffer({ resolveWithObject: true });

        const { width, height } = processed.info;
        const originalBuffer = processed.data;

        // Generate thumbnail
        const thumbBuffer = await sharp(buffer)
          .rotate()
          .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();

        const processedKey = `${item.keyPrefix}/original.jpg`;
        const thumbKey = `${item.keyPrefix}/thumb.jpg`;

        await Promise.all([
          uploadToR2(processedKey, originalBuffer, "image/jpeg"),
          uploadToR2(thumbKey, thumbBuffer, "image/jpeg"),
        ]);

        mediaRecords.push({
          id: mediaId,
          r2Key: processedKey,
          thumbKey,
          type: "photo",
          width,
          height,
          fileSize: originalBuffer.length,
          displayOrder: i,
        });
      }
    }

    // Determine post date
    let postDate: Date;
    if (dateOverride) {
      postDate = new Date(dateOverride);
      if (isNaN(postDate.getTime())) postDate = firstExifDate || new Date();
    } else {
      postDate = firstExifDate || new Date();
    }

    // Determine post type
    const hasPhotos = mediaRecords.some((m) => m.type === "photo");
    const hasVideos = mediaRecords.some((m) => m.type === "video");
    let postType: string;
    if (hasPhotos && hasVideos) postType = "mixed";
    else if (hasVideos) postType = "video";
    else postType = "photo";

    // Generate photoset_layout for multi-photo posts
    let photosetLayout: string | null = null;
    if (mediaRecords.length > 1) {
      photosetLayout = generatePhotosetLayout(mediaRecords.length);
    }

    // Generate IDs and slug
    const postId = nanoid();
    const dateStr = postDate.toISOString().replace("T", " ").replace("Z", "");
    const postTitle = title?.trim() || null;
    const slugBase = postTitle
      ? slugify(postTitle)
      : `photo-${postDate.getFullYear()}-${String(postDate.getMonth() + 1).padStart(2, "0")}-${String(postDate.getDate()).padStart(2, "0")}`;
    const slug = await uniqueSlug(slugBase);

    // Insert post
    await db.execute({
      sql: `INSERT INTO posts (id, slug, title, body, date, type, photoset_layout, created_at, updated_at)
            VALUES (?, ?, ?, NULL, ?, ?, ?, datetime('now'), datetime('now'))`,
      args: [postId, slug, postTitle, dateStr, postType, photosetLayout],
    });

    // Insert media records
    for (const m of mediaRecords) {
      await db.execute({
        sql: `INSERT INTO media (id, post_id, r2_key, thumbnail_r2_key, type, width, height, file_size, display_order, mime_type)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          m.id,
          postId,
          m.r2Key,
          m.thumbKey || null,
          m.type,
          m.width || null,
          m.height || null,
          m.fileSize || null,
          m.displayOrder,
          m.type === "video" ? "video/mp4" : "image/jpeg",
        ],
      });
    }

    // Tags
    const tagIds: string[] = [];
    for (const name of tagNames) {
      if (!name.trim()) continue;
      const tagId = await findOrCreateTag(name);
      tagIds.push(tagId);
      await db.execute({
        sql: "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
        args: [postId, tagId],
      });
    }

    // People
    const personIds: string[] = [];
    for (const name of peopleNames) {
      if (!name.trim()) continue;
      const personId = await findOrCreatePerson(name);
      personIds.push(personId);
      await db.execute({
        sql: "INSERT OR IGNORE INTO post_people (post_id, person_id) VALUES (?, ?)",
        args: [postId, personId],
      });
    }

    // Albums
    for (const albumId of albumIds) {
      if (!albumId.trim()) continue;
      await db.execute({
        sql: "INSERT OR IGNORE INTO post_albums (post_id, album_id) VALUES (?, ?)",
        args: [postId, albumId],
      });
    }

    // Build FTS data
    const tagNamesForFts = tagNames.filter((n) => n.trim()).join(" ");
    const peopleNamesForFts = peopleNames.filter((n) => n.trim()).join(" ");

    await db.execute({
      sql: `INSERT INTO posts_fts(post_id, title, body, tags, people)
            VALUES (?, ?, '', ?, ?)`,
      args: [postId, postTitle || "", tagNamesForFts, peopleNamesForFts],
    });

    return NextResponse.json({
      success: true,
      slug,
      postId,
      date: dateStr,
      exifDate: firstExifDate?.toISOString() || null,
      mediaCount: mediaRecords.length,
      type: postType,
    });
  } catch (error) {
    console.error("Upload complete error:", error);
    return NextResponse.json(
      { error: "Processing failed" },
      { status: 500 }
    );
  }
}

/** Generate a photoset layout string matching the app's grid logic */
function generatePhotosetLayout(count: number): string {
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count === 3) return "21";
  if (count === 4) return "22";

  // For 5+: rows of 2-3
  const rows: number[] = [];
  let remaining = count;
  while (remaining > 0) {
    if (remaining >= 5) {
      rows.push(3);
      remaining -= 3;
    } else if (remaining === 4) {
      rows.push(2);
      rows.push(2);
      remaining = 0;
    } else if (remaining === 3) {
      rows.push(3);
      remaining = 0;
    } else if (remaining === 2) {
      rows.push(2);
      remaining = 0;
    } else {
      rows.push(1);
      remaining = 0;
    }
  }
  return rows.join("");
}
