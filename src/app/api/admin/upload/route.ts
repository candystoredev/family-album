import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { uploadToR2 } from "@/lib/r2";
import { db } from "@/lib/db";

const THUMB_WIDTH = 400;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/** Generate a unique slug, appending -2, -3, etc. if needed */
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

/**
 * Generate a timestamp-based R2 key prefix from a Date.
 * Format: media/YYYYMMDD-HHmmUTC
 * If the key already exists, appends -2, -3, etc.
 */
function timestampKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `media/${y}${m}${d}-${h}${min}UTC`;
}

/**
 * Extract date/time from EXIF data.
 * sharp exposes exif as a raw buffer — we parse the DateTimeOriginal tag.
 */
async function extractExifDate(buffer: Buffer): Promise<Date | null> {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.exif) return null;

    // Parse EXIF buffer to find DateTimeOriginal (tag 0x9003) or DateTime (tag 0x0132)
    const exifStr = metadata.exif.toString("binary");

    // Look for date pattern in EXIF: "YYYY:MM:DD HH:MM:SS"
    const dateMatch = exifStr.match(
      /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/
    );
    if (dateMatch) {
      const [, yr, mo, dy, hr, mi, sc] = dateMatch;
      const d = new Date(
        `${yr}-${mo}-${dy}T${hr}:${mi}:${sc}`
      );
      if (!isNaN(d.getTime())) return d;
    }

    return null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string) || null;
    const dateOverride = formData.get("date") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}` },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 20MB)" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

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

    // Process image with sharp: convert to JPEG, strip EXIF, get dimensions
    const processed = await sharp(buffer)
      .rotate() // Auto-rotate based on EXIF orientation
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

    // Generate R2 keys
    const keyPrefix = timestampKey(postDate);
    // Check for key collision by appending nanoid suffix
    const keySuffix = nanoid(4);
    const originalKey = `${keyPrefix}-${keySuffix}/original.jpg`;
    const thumbKey = `${keyPrefix}-${keySuffix}/thumb.jpg`;

    // Upload to R2
    await Promise.all([
      uploadToR2(originalKey, originalBuffer, "image/jpeg"),
      uploadToR2(thumbKey, thumbBuffer, "image/jpeg"),
    ]);

    // Generate IDs and slug
    const postId = nanoid();
    const mediaId = nanoid();
    const dateStr = postDate.toISOString().replace("T", " ").replace("Z", "");

    // Generate slug from title or date
    const slugBase = title
      ? slugify(title)
      : `photo-${postDate.getFullYear()}-${String(postDate.getMonth() + 1).padStart(2, "0")}-${String(postDate.getDate()).padStart(2, "0")}`;
    const slug = await uniqueSlug(slugBase);

    // Insert post and media
    await db.execute({
      sql: `INSERT INTO posts (id, slug, title, body, date, type, created_at, updated_at)
            VALUES (?, ?, ?, NULL, ?, 'photo', datetime('now'), datetime('now'))`,
      args: [postId, slug, title, dateStr],
    });

    await db.execute({
      sql: `INSERT INTO media (id, post_id, r2_key, thumbnail_r2_key, type, width, height, file_size, display_order, mime_type)
            VALUES (?, ?, ?, ?, 'photo', ?, ?, ?, 0, 'image/jpeg')`,
      args: [
        mediaId,
        postId,
        originalKey,
        thumbKey,
        width,
        height,
        originalBuffer.length,
      ],
    });

    // Update FTS index for this post
    await db.execute({
      sql: `INSERT INTO posts_fts(post_id, title, body, tags, people)
            VALUES (?, ?, '', '', '')`,
      args: [postId, title || ""],
    });

    return NextResponse.json({
      success: true,
      slug,
      postId,
      date: dateStr,
      exifDate: exifDate?.toISOString() || null,
      dimensions: { width, height },
      r2Keys: { original: originalKey, thumbnail: thumbKey },
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
