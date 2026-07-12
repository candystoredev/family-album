import sharp from "sharp";

export { MAX_UPLOAD_BYTES } from "./upload-limits";

/**
 * Re-encode an uploaded photo into the exact bytes served as the public
 * `original.jpg` (Phase 11d).
 *
 * `.rotate()` bakes EXIF orientation into the pixels, so the output never
 * needs an orientation tag to display correctly. The deliberate absence of
 * `.withMetadata()` strips ALL EXIF from the output — including GPS. That's
 * the point, not a side effect: capture date, GPS, device info, and the raw
 * EXIF blob are already parsed and written to the DB at ingest time (see
 * `extractPhotoExtras` / `resolveOriginalCapture` in the upload/complete
 * route), so nothing is lost — the publicly-served JPEG just no longer needs
 * to carry that data itself, and therefore can't leak a family member's home
 * GPS coordinates to anyone who downloads the image.
 *
 * Every photo written to R2 as the served original MUST go through this —
 * there must be no "already a clean JPEG, skip re-encoding" fast path, since
 * that would serve the raw uploaded bytes (and their EXIF/GPS) unmodified.
 */
export async function processUploadPhoto(
  buffer: Buffer
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(buffer)
    .rotate()
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
