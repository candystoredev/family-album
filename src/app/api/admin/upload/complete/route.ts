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

/**
 * Complete the upload: download from R2, extract EXIF, generate thumbnail,
 * create post + media records.
 *
 * Client sends: { r2Key, keyPrefix, title?, date? }
 */
export async function POST(request: NextRequest) {
  try {
    const { r2Key, keyPrefix, title, date: dateOverride } = await request.json();

    if (!r2Key || !keyPrefix) {
      return NextResponse.json(
        { error: "Missing r2Key or keyPrefix" },
        { status: 400 }
      );
    }

    // Download the uploaded file from R2
    const buffer = await downloadFromR2(r2Key);

    // Extract EXIF date
    const exifDate = await extractExifDate(buffer);

    // Determine post date
    let postDate: Date;
    if (dateOverride) {
      postDate = new Date(dateOverride);
      if (isNaN(postDate.getTime())) postDate = exifDate || new Date();
    } else {
      postDate = exifDate || new Date();
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

    // Re-upload the processed original (EXIF-stripped, rotated JPEG)
    // and upload thumbnail
    const processedKey = `${keyPrefix}/original.jpg`;
    const thumbKey = `${keyPrefix}/thumb.jpg`;

    await Promise.all([
      uploadToR2(processedKey, originalBuffer, "image/jpeg"),
      uploadToR2(thumbKey, thumbBuffer, "image/jpeg"),
    ]);

    // Generate IDs and slug
    const postId = nanoid();
    const mediaId = nanoid();
    const dateStr = postDate.toISOString().replace("T", " ").replace("Z", "");

    const postTitle = title?.trim() || null;
    const slugBase = postTitle
      ? slugify(postTitle)
      : `photo-${postDate.getFullYear()}-${String(postDate.getMonth() + 1).padStart(2, "0")}-${String(postDate.getDate()).padStart(2, "0")}`;
    const slug = await uniqueSlug(slugBase);

    // Insert post and media
    await db.execute({
      sql: `INSERT INTO posts (id, slug, title, body, date, type, created_at, updated_at)
            VALUES (?, ?, ?, NULL, ?, 'photo', datetime('now'), datetime('now'))`,
      args: [postId, slug, postTitle, dateStr],
    });

    await db.execute({
      sql: `INSERT INTO media (id, post_id, r2_key, thumbnail_r2_key, type, width, height, file_size, display_order, mime_type)
            VALUES (?, ?, ?, ?, 'photo', ?, ?, ?, 0, 'image/jpeg')`,
      args: [mediaId, postId, processedKey, thumbKey, width, height, originalBuffer.length],
    });

    // Update FTS index
    await db.execute({
      sql: `INSERT INTO posts_fts(post_id, title, body, tags, people)
            VALUES (?, ?, '', '', '')`,
      args: [postId, postTitle || ""],
    });

    return NextResponse.json({
      success: true,
      slug,
      postId,
      date: dateStr,
      exifDate: exifDate?.toISOString() || null,
      dimensions: { width, height },
      r2Keys: { original: processedKey, thumbnail: thumbKey },
    });
  } catch (error) {
    console.error("Upload complete error:", error);
    return NextResponse.json(
      { error: "Processing failed" },
      { status: 500 }
    );
  }
}
