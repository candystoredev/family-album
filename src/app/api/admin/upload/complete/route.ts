import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import sharp from "sharp";
import exifr from "exifr";
import { downloadFromR2, uploadToR2 } from "@/lib/r2";
import { db } from "@/lib/db";
import { generatePhotosetLayout } from "@/lib/media/layout";
import { ensureRichMetadataSchema } from "@/lib/schema";
import {
  resolveCaptureDate,
  type CaptureDate,
  type CaptureDateInput,
} from "@/lib/media/capture-date";

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

interface MediaItem {
  r2Key: string;
  keyPrefix: string;
  type: "photo" | "video";
  posterDataUrl?: string; // base64 data URL for video poster frame
  capture?: CaptureDateInput; // raw capture-date inputs from the original (10.1a)
}

/**
 * Server-side capture resolution (Phase 10.1a). Prefers the client's raw inputs
 * (extracted from the original before compression); for the originals path that
 * sends none (e.g. iOS Shortcut), re-extracts photo EXIF with the SAME rule
 * (reviveValues:false → naive string) so client and server can't disagree.
 */
async function resolveServerCapture(
  item: MediaItem,
  buffer: Buffer | null,
  nowMs: number
): Promise<CaptureDate> {
  let input: CaptureDateInput = item.capture ?? {};
  if (!item.capture && buffer && item.type === "photo") {
    try {
      const tags = await exifr.parse(buffer, {
        pick: ["DateTimeOriginal", "CreateDate", "OffsetTimeOriginal", "OffsetTimeDigitized"],
        reviveValues: false,
      });
      input = {
        exifDateTimeOriginal: tags?.DateTimeOriginal ?? tags?.CreateDate ?? null,
        exifOffsetTimeOriginal: tags?.OffsetTimeOriginal ?? tags?.OffsetTimeDigitized ?? null,
      };
    } catch {
      // No readable EXIF — fall through to upload_fallback.
    }
  }
  return resolveCaptureDate(input, nowMs);
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
    const clientLayout: string | undefined = body.photosetLayout;

    if (items.length === 0 || !items[0].r2Key) {
      return NextResponse.json(
        { error: "No media items provided" },
        { status: 400 }
      );
    }

    // Phase 10.1a — make sure the rich-metadata columns exist before we write
    // them (works on an already-deployed DB without re-running /api/init).
    await ensureRichMetadataSchema();

    // One clock for the whole post so any upload_fallback dates agree.
    const nowMs = Date.now();

    // Process all media items in parallel
    let firstExifDate: Date | null = null;

    const mediaResults = await Promise.all(
      items.map(async (item, i) => {
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
          // Video bytes aren't downloaded server-side; rely on the client's
          // container-parsed capture (or filename/mtime/upload fallback).
          const capture = await resolveServerCapture(item, null, nowMs);
          return {
            id: mediaId,
            r2Key: item.r2Key,
            thumbKey,
            type: "video" as const,
            width: 0,
            height: 0,
            fileSize: 0,
            displayOrder: i,
            exifDate: null as Date | null,
            capture,
          };
        }

        // Photo: download, extract EXIF, process, thumbnail — all at once
        const buffer = await downloadFromR2(item.r2Key);
        const exifDate = await extractExifDate(buffer);
        const capture = await resolveServerCapture(item, buffer, nowMs);

        // Client uploads are already ≤1920px JPEGs with orientation baked in
        // (canvas re-encode) — re-encoding those again just burns time and
        // quality. Only re-encode when rotation or format conversion is needed.
        const meta = await sharp(buffer).metadata();
        const alreadyProcessed =
          meta.format === "jpeg" && (!meta.orientation || meta.orientation === 1);

        const [processed, thumbBuffer] = await Promise.all([
          alreadyProcessed
            ? Promise.resolve({
                data: buffer,
                info: { width: meta.width ?? 0, height: meta.height ?? 0 },
              })
            : sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true }),
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

        return {
          id: mediaId,
          r2Key: processedKey,
          thumbKey,
          type: "photo" as const,
          width,
          height,
          fileSize: originalBuffer.length,
          displayOrder: i,
          exifDate,
          capture,
        };
      })
    );

    // Extract first EXIF date from results (preserve original order)
    for (const r of mediaResults) {
      if (r.exifDate) {
        firstExifDate = r.exifDate;
        break;
      }
    }

    const mediaRecords = mediaResults.map(({ exifDate, ...rest }) => rest);

    // Posts rollup (10.1a): representative = the media with the earliest known
    // capture instant (display order breaks ties). A manual date override wins,
    // so posts.taken_at/local_date stay consistent with the legacy posts.date.
    // Written alongside posts.date — reads still use posts.date until 10.2.
    const earliestCapture = mediaRecords
      .filter((m) => m.capture.takenAt)
      .sort((a, b) => {
        const t = (a.capture.takenAt ?? "").localeCompare(b.capture.takenAt ?? "");
        return t !== 0 ? t : a.displayOrder - b.displayOrder;
      })[0]?.capture;
    const manualRollup =
      dateOverride && !isNaN(new Date(dateOverride).getTime())
        ? resolveCaptureDate({ manual: dateOverride }, nowMs)
        : null;
    const repCapture = manualRollup ?? earliestCapture;

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

    // Use client-provided layout or auto-generate for multi-photo posts
    let photosetLayout: string | null = null;
    if (mediaRecords.length > 1) {
      if (clientLayout) {
        // Validate client layout: digits must sum to media count
        const digits = clientLayout.split("").map(Number);
        const sum = digits.reduce((a, b) => a + b, 0);
        if (sum === mediaRecords.length && digits.every((d) => d >= 1 && d <= 3)) {
          photosetLayout = clientLayout;
        } else {
          photosetLayout = generatePhotosetLayout(mediaRecords.length);
        }
      } else {
        photosetLayout = generatePhotosetLayout(mediaRecords.length);
      }
    }

    // Generate IDs and slug
    const postId = nanoid();
    const dateStr = postDate.toISOString().replace("T", " ").replace("Z", "");
    const postTitle = title?.trim() || null;
    const slugBase = postTitle
      ? slugify(postTitle)
      : `photo-${postDate.getFullYear()}-${String(postDate.getMonth() + 1).padStart(2, "0")}-${String(postDate.getDate()).padStart(2, "0")}`;
    const slug = await uniqueSlug(slugBase);

    // Sequential db.execute calls each cost a Turso HTTP roundtrip — for a
    // 4-photo post that was ~12 of them, the bulk of publish latency. Resolve
    // tag/person ids in two batched roundtrips, then write everything
    // (post + media + links + FTS) in one atomic batch.
    const cleanTags = tagNames.filter((n) => n.trim()).map((n) => n.trim());
    const cleanPeople = peopleNames.filter((n) => n.trim()).map((n) => n.trim());
    const cleanAlbumIds = albumIds.filter((a) => a.trim());

    const ensureStmts = [
      ...cleanTags.map((name) => ({
        sql: "INSERT OR IGNORE INTO tags (id, name, slug) VALUES (?, ?, ?)",
        args: [nanoid(), name, slugify(name)],
      })),
      ...cleanPeople.map((name) => ({
        sql: "INSERT OR IGNORE INTO people (id, name, slug) VALUES (?, ?, ?)",
        args: [nanoid(), name, slugify(name)],
      })),
    ];
    if (ensureStmts.length > 0) await db.batch(ensureStmts, "write");

    const tagIds: string[] = [];
    if (cleanTags.length > 0) {
      const res = await db.execute({
        sql: `SELECT id FROM tags WHERE slug IN (${cleanTags.map(() => "?").join(",")})`,
        args: cleanTags.map(slugify),
      });
      tagIds.push(...res.rows.map((r) => r.id as string));
    }
    const personIds: string[] = [];
    if (cleanPeople.length > 0) {
      const res = await db.execute({
        sql: `SELECT id FROM people WHERE slug IN (${cleanPeople.map(() => "?").join(",")})`,
        args: cleanPeople.map(slugify),
      });
      personIds.push(...res.rows.map((r) => r.id as string));
    }

    await db.batch(
      [
        {
          sql: `INSERT INTO posts (id, slug, title, body, date, type, photoset_layout, created_at, updated_at,
                                    taken_at, local_date, date_source, source)
                VALUES (?, ?, ?, NULL, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, 'upload')`,
          args: [
            postId,
            slug,
            postTitle,
            dateStr,
            postType,
            photosetLayout,
            repCapture?.takenAt ?? null,
            repCapture?.localDate ?? null,
            repCapture?.source ?? null,
          ],
        },
        ...mediaRecords.map((m) => ({
          sql: `INSERT INTO media (id, post_id, r2_key, thumbnail_r2_key, type, width, height, file_size, display_order, mime_type,
                                   taken_at, tz_offset, local_date, date_source, date_confidence, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload')`,
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
            m.capture.takenAt,
            m.capture.tzOffsetMin,
            m.capture.localDate,
            m.capture.source,
            m.capture.confidence,
          ],
        })),
        ...tagIds.map((tagId) => ({
          sql: "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
          args: [postId, tagId],
        })),
        ...personIds.map((personId) => ({
          sql: "INSERT OR IGNORE INTO post_people (post_id, person_id) VALUES (?, ?)",
          args: [postId, personId],
        })),
        ...cleanAlbumIds.map((albumId) => ({
          sql: "INSERT OR IGNORE INTO post_albums (post_id, album_id) VALUES (?, ?)",
          args: [postId, albumId],
        })),
        {
          sql: `INSERT INTO posts_fts(post_id, title, body, tags, people)
                VALUES (?, ?, '', ?, ?)`,
          args: [postId, postTitle || "", cleanTags.join(" "), cleanPeople.join(" ")],
        },
      ],
      "write"
    );

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
