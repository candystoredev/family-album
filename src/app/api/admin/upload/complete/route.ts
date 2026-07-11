import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import sharp from "sharp";
import exifr from "exifr";
import { downloadFromR2, uploadToR2, deleteFromR2 } from "@/lib/r2";
import { db } from "@/lib/db";
import { generatePhotosetLayout } from "@/lib/media/layout";
import { perceptualHash, dominantColor } from "@/lib/media/image-hash";
import { extractPhotoExtras, type MediaExtras } from "@/lib/media/extract";
import { processUploadPhoto, MAX_UPLOAD_BYTES } from "@/lib/media/process-photo";
import { ensureRichMetadataSchema, ftsRowFor } from "@/lib/schema";
import { slugify } from "@/lib/slugify";
import {
  resolveCaptureDate,
  type CaptureDate,
  type CaptureDateInput,
} from "@/lib/media/capture-date";

const THUMB_WIDTH = 400;

/**
 * A client-supplied R2 key/prefix is only safe if it stays under the media/
 * prefix (where presign writes) and can't escape it with "..". Without this an
 * authenticated admin could read (downloadFromR2) or overwrite (uploadToR2) any
 * object in the bucket. Mirrors the guard in ../ingest-fetch/route.ts.
 */
function isSafeR2Path(p: string | undefined): boolean {
  return typeof p === "string" && p.startsWith("media/") && !p.includes("..");
}

/**
 * Thrown when a photo's downloaded original exceeds MAX_UPLOAD_BYTES
 * (Phase 11d). Caught in the POST handler and turned into a 413 — the
 * client also pre-checks this (src/app/admin/upload/page.tsx) but that's a
 * friendliness optimization, not the enforcement boundary.
 */
class UploadTooLargeError extends Error {
  constructor(filename: string, size: number) {
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    super(
      `"${filename}" is ${mb(size)} MB, which exceeds the ${mb(MAX_UPLOAD_BYTES)} MB upload limit.`
    );
    this.name = "UploadTooLargeError";
  }
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
  contentHash?: string; // SHA-256 of the original bytes, client-computed (10.1b)
  meta?: MediaExtras; // GPS + device + raw EXIF from the original (10.1c)
}

const EMPTY_EXTRAS: MediaExtras = { gps: null, device: null, raw: null };

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

    // Reject any client-supplied key/prefix that escapes the media/ prefix
    // before we hand it to downloadFromR2/uploadToR2 (arbitrary bucket
    // read/write otherwise). A single bad item fails the whole request.
    for (const item of items) {
      if (!isSafeR2Path(item.r2Key) || !isSafeR2Path(item.keyPrefix)) {
        return NextResponse.json(
          { error: "Invalid media key" },
          { status: 400 }
        );
      }
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
          // Served videos are the raw uploaded file, byte-for-byte (r2Key
          // below), so any GPS/EXIF/location metadata embedded in the video
          // container is NOT stripped — unlike photos (see processUploadPhoto
          // in src/lib/media/process-photo.ts). Stripping it would require
          // server-side ffmpeg/transcoding, which this architecture
          // deliberately avoids (docs/DECISIONS.md, "Direct R2 serve for
          // video, no transcoding" — no cost/latency for encoding, modern
          // devices handle MP4 natively). Tracked as a known limitation of
          // Phase 11d rather than solved here.
          let thumbKey = "";
          let phash: string | null = null;
          let domColor: string | null = null;
          if (item.posterDataUrl) {
            const base64 = item.posterDataUrl.split(",")[1];
            const posterBuffer = Buffer.from(base64, "base64");
            const thumbBuffer = await sharp(posterBuffer)
              .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
              .jpeg({ quality: 80 })
              .toBuffer();
            thumbKey = `${item.keyPrefix}/thumb.jpg`;
            await uploadToR2(thumbKey, thumbBuffer, "image/jpeg");
            // Poster-frame phash lets the 10.3 backfill match videos too.
            [phash, domColor] = await Promise.all([
              perceptualHash(thumbBuffer),
              dominantColor(thumbBuffer),
            ]);
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
            contentHash: item.contentHash ?? null,
            phash,
            dominantColor: domColor,
            aspect: null as number | null,
            orientation: null as number | null,
            originalFilename: item.capture?.filename ?? null,
            extras: EMPTY_EXTRAS, // video container GPS/codec parse deferred
          };
        }

        // Photo: download, extract EXIF, process, thumbnail — all at once
        const buffer = await downloadFromR2(item.r2Key);

        // Server-side enforcement of the upload size cap (Phase 11d). The
        // client pre-checks this too (src/app/admin/upload/page.tsx), but a
        // stale client or a direct API call must still be blocked here. Clean
        // up the staged R2 object(s) for this item before failing the request.
        if (buffer.length > MAX_UPLOAD_BYTES) {
          await Promise.allSettled([
            deleteFromR2(item.r2Key),
            deleteFromR2(`${item.keyPrefix}/thumb.jpg`),
          ]);
          throw new UploadTooLargeError(
            item.capture?.filename ?? item.r2Key,
            buffer.length
          );
        }

        const exifDate = await extractExifDate(buffer);
        const capture = await resolveServerCapture(item, buffer, nowMs);
        const meta = await sharp(buffer).metadata();

        // Every served original goes through processUploadPhoto — no
        // "already a clean JPEG" fast path. That old fast path skipped the
        // sharp re-encode for already-upright JPEGs, which meant the RAW
        // downloaded bytes (EXIF/GPS intact) were served as the public
        // original.jpg. See src/lib/media/process-photo.ts for why the
        // re-encode strips EXIF/GPS deliberately.
        const [processed, thumbBuffer] = await Promise.all([
          processUploadPhoto(buffer),
          sharp(buffer).rotate().resize(THUMB_WIDTH, null, { withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(),
        ]);

        const { width, height } = processed;
        const originalBuffer = processed.data;
        const processedKey = `${item.keyPrefix}/original.jpg`;
        const thumbKey = `${item.keyPrefix}/thumb.jpg`;

        // Identity + visual metadata (10.1b). content_hash must be of the
        // ORIGINAL: the client sends it for compressed uploads; for the
        // originals path (e.g. iOS Shortcut) `buffer` IS the original.
        const [phash, domColor] = await Promise.all([
          perceptualHash(thumbBuffer),
          dominantColor(thumbBuffer),
        ]);
        const contentHash =
          item.contentHash ?? createHash("sha256").update(buffer).digest("hex");
        // GPS/device/raw (10.1c): client sends from the original; for the
        // originals path we re-extract from the buffer with the same mapper.
        const extras = item.meta ?? (await extractPhotoExtras(buffer));

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
          contentHash,
          phash,
          dominantColor: domColor,
          aspect: width && height ? width / height : null,
          orientation: meta.orientation ?? null,
          originalFilename: item.capture?.filename ?? null,
          extras,
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

    // New posts from this route are created with body = NULL (no caption
    // field on upload) — ftsRowFor COALESCEs that to '', matching
    // rebuildFtsIndex(). If a body field is ever added here, pass its real
    // value instead of null.
    const ftsRow = ftsRowFor({ title: postTitle, body: null, tagNames: cleanTags, peopleNames: cleanPeople });

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
                                   taken_at, tz_offset, local_date, date_source, date_confidence, source,
                                   content_hash, phash, dominant_color, aspect, orientation, original_filename,
                                   gps_lat, gps_lng, gps_altitude,
                                   camera_make, camera_model, lens, iso, aperture, shutter_speed, focal_length)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            m.contentHash,
            m.phash,
            m.dominantColor,
            m.aspect,
            m.orientation,
            m.originalFilename,
            m.extras.gps?.lat ?? null,
            m.extras.gps?.lng ?? null,
            m.extras.gps?.altitude ?? null,
            m.extras.device?.make ?? null,
            m.extras.device?.model ?? null,
            m.extras.device?.lens ?? null,
            m.extras.device?.iso ?? null,
            m.extras.device?.aperture ?? null,
            m.extras.device?.shutterSpeed ?? null,
            m.extras.device?.focalLength ?? null,
          ],
        })),
        // Full raw EXIF payload — kept verbatim so a future feature never re-scans.
        ...mediaRecords
          .filter((m) => m.extras.raw)
          .map((m) => ({
            sql: `INSERT INTO media_metadata_raw (id, media_id, source, payload) VALUES (?, ?, 'exif', ?)`,
            args: [nanoid(), m.id, JSON.stringify(m.extras.raw)],
          })),
        // Origin reference for re-sync / backfill corroboration (10.3).
        ...mediaRecords.map((m) => ({
          sql: `INSERT INTO media_sources (id, media_id, kind, content_hash, phash, match_method, match_confidence, matched_at)
                VALUES (?, ?, 'upload', ?, ?, 'direct', 1.0, datetime('now'))`,
          args: [nanoid(), m.id, m.contentHash, m.phash],
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
                VALUES (?, ?, ?, ?, ?)`,
          args: [postId, ftsRow.title, ftsRow.body, ftsRow.tags, ftsRow.people],
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
    if (error instanceof UploadTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    console.error("Upload complete error:", error);
    return NextResponse.json(
      { error: "Processing failed" },
      { status: 500 }
    );
  }
}
