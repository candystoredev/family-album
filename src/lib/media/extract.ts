import exifr from "exifr";
import { getVideoCapture } from "./exif";
import type { CaptureDateInput } from "./capture-date";

/**
 * Build the raw, serializable capture-date inputs from the ORIGINAL file
 * (Phase 10.1a), client-side, before `compressImage` re-encodes and strips EXIF.
 *
 * Deliberately returns RAW values, not a resolved date: the single source of
 * truth for resolution is `resolveCaptureDate`, run once on the server. The one
 * rule that must hold here is "don't let the host timezone mangle a naive EXIF
 * time" — so we read EXIF with `reviveValues: false`, which yields the original
 * "YYYY:MM:DD HH:MM:SS" string rather than a `Date` built in browser-local time.
 * Video instants already carry their own offset, so they're safe to serialize.
 *
 * This payload is sent per-item to /complete; the server resolves it (or, for
 * the originals path that sends no payload, re-extracts with the same rule).
 */
export async function buildCaptureInput(
  file: File,
  isVideo: boolean
): Promise<CaptureDateInput> {
  const base: CaptureDateInput = {
    filename: file.name,
    fileLastModifiedMs: file.lastModified || null,
  };

  if (isVideo) {
    try {
      const v = await getVideoCapture(file);
      if (v) return { ...base, videoCreation: v };
    } catch {
      // Unreadable container — fall back to filename/mtime server-side.
    }
    return base;
  }

  try {
    const tags = await exifr.parse(file, {
      pick: [
        "DateTimeOriginal",
        "CreateDate",
        "OffsetTimeOriginal",
        "OffsetTimeDigitized",
      ],
      reviveValues: false, // keep naive EXIF as its raw string
    });
    return {
      ...base,
      exifDateTimeOriginal: tags?.DateTimeOriginal ?? tags?.CreateDate ?? null,
      exifOffsetTimeOriginal:
        tags?.OffsetTimeOriginal ?? tags?.OffsetTimeDigitized ?? null,
    };
  } catch {
    // Corrupt/absent EXIF — server falls back to filename/mtime.
    return base;
  }
}
