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

/**
 * SHA-256 of the ORIGINAL file bytes (Phase 10.1b), as lowercase hex. Computed
 * client-side because compression replaces the bytes — this hash must identify
 * the true original (for dedup + the 10.3 backfill). Null on failure.
 */
export async function sha256Hex(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/** GPS + device + the full raw EXIF dump (Phase 10.1c). All nullable. */
export interface MediaExtras {
  gps: { lat: number | null; lng: number | null; altitude: number | null } | null;
  device: {
    make: string | null;
    model: string | null;
    lens: string | null;
    iso: number | null;
    aperture: number | null;
    shutterSpeed: string | null;
    focalLength: number | null;
  } | null;
  /** Full extracted payload, kept verbatim → media_metadata_raw (never re-scan). */
  raw: Record<string, unknown> | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** JSON-safe deep clone (exifr can yield BigInt / typed arrays). Null on failure. */
function jsonSafe(v: unknown): Record<string, unknown> | null {
  try {
    return JSON.parse(
      JSON.stringify(v, (_k, val) => {
        if (typeof val === "bigint") return val.toString();
        if (val instanceof Uint8Array) return Array.from(val);
        return val;
      })
    );
  } catch {
    return null;
  }
}

/** Map a parsed exifr tag object to MediaExtras. Shared by client and the
 *  server originals-path fallback so both produce identical fields. */
export function mapTagsToExtras(tags: Record<string, unknown> | null | undefined): MediaExtras {
  if (!tags) return { gps: null, device: null, raw: null };
  const lat = num(tags.latitude);
  const lng = num(tags.longitude);
  const gps = lat != null || lng != null ? { lat, lng, altitude: num(tags.GPSAltitude) } : null;
  return {
    gps,
    device: {
      make: str(tags.Make),
      model: str(tags.Model),
      lens: str(tags.LensModel) ?? str(tags.LensInfo),
      iso: num(tags.ISO),
      aperture: num(tags.FNumber),
      shutterSpeed: tags.ExposureTime != null ? String(tags.ExposureTime) : null,
      focalLength: num(tags.FocalLength),
    },
    raw: jsonSafe(tags),
  };
}

// tiff includes the IFD0 tags (Make/Model); exif + gps add those sub-IFDs.
const EXIF_PICK = { tiff: true, exif: true, gps: true } as const;

/**
 * Extract GPS, device, and the full raw EXIF payload from a photo ORIGINAL
 * (Phase 10.1c), before compression strips it. Photos only — video GPS/codec
 * live in the container and are parsed separately (deferred). Accepts a File
 * (client) or a Buffer/ArrayBuffer (server originals-path fallback).
 */
export async function extractPhotoExtras(
  input: Blob | ArrayBuffer | Uint8Array
): Promise<MediaExtras> {
  try {
    return mapTagsToExtras(await exifr.parse(input, EXIF_PICK));
  } catch {
    return { gps: null, device: null, raw: null };
  }
}
