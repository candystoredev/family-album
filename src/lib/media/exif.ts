import exifr from "exifr";

export type DateSource = "exif" | "filename" | "file";

export interface MediaDate {
  date: Date;
  source: DateSource;
}

/**
 * Date patterns commonly embedded in filenames by phones, scanners, and
 * messaging exports: IMG_20190704_..., 2019-07-04 ..., 2019_07_04, 20190704.
 * Year restricted to 19xx/20xx to avoid matching arbitrary digit runs.
 */
const FILENAME_DATE_RE =
  /(?:^|\D)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?=\D|$)/;

export function dateFromFilename(name: string): Date | null {
  const m = name.match(FILENAME_DATE_RE);
  if (!m) return null;
  const [, y, mo, d] = m;
  // Noon local time so timezone shifts can't move it to the wrong day
  const date = new Date(Number(y), Number(mo) - 1, Number(d), 12, 0, 0);
  if (isNaN(date.getTime())) return null;
  // Reject impossible dates that still parse (e.g. Feb 30 rolls over)
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return null;
  return date;
}

/**
 * Best-effort capture date for a file, client-side.
 * Must run on the ORIGINAL file — canvas re-encoding (compressImage) strips EXIF.
 */
export async function getMediaDate(file: File): Promise<MediaDate> {
  if (file.type.startsWith("image/")) {
    try {
      const tags = await exifr.parse(file, ["DateTimeOriginal", "CreateDate"]);
      const d: unknown = tags?.DateTimeOriginal ?? tags?.CreateDate;
      if (d instanceof Date && !isNaN(d.getTime())) {
        return { date: d, source: "exif" };
      }
    } catch {
      // Corrupt or absent EXIF — fall through to filename/mtime
    }
  }
  const fromName = dateFromFilename(file.name);
  if (fromName) return { date: fromName, source: "filename" };
  return { date: new Date(file.lastModified), source: "file" };
}

// ─── Video capture date ───────────────────────────────────────────────────────

/** Seconds between the QuickTime/MP4 epoch (1904-01-01) and the Unix epoch. */
const MP4_EPOCH_OFFSET = 2082844800;

async function readView(blob: Blob, start: number, len: number): Promise<DataView> {
  const buf = await blob.slice(start, start + len).arrayBuffer();
  return new DataView(buf);
}

function atomType(view: DataView, off: number): string {
  return String.fromCharCode(
    view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3)
  );
}

/** Convert an MP4/MOV creation_time (seconds since 1904) to a Date on the
 *  recorded calendar day at local noon — mirrors dateFromFilename so timezone
 *  conversion can't bump it to the wrong day. Returns null if implausible. */
function mp4TimeToDate(seconds: number): Date | null {
  if (!seconds) return null;
  const d = new Date((seconds - MP4_EPOCH_OFFSET) * 1000);
  const year = d.getUTCFullYear();
  if (isNaN(d.getTime()) || year < 1990 || year > 2100) return null;
  return new Date(year, d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
}

/**
 * Read the capture date from an MP4/MOV container by walking top-level atoms to
 * `moov`, then its `mvhd` (movie header) creation_time. Reads only atom headers
 * (a few bytes each) via Blob slices, so it never loads the whole video.
 * Returns null if the structure isn't found.
 */
export async function getVideoCreationDate(file: Blob): Promise<Date | null> {
  const size = file.size;

  // Find the moov atom among the top-level atoms.
  let offset = 0;
  let moov: { start: number; end: number } | null = null;
  while (offset + 8 <= size) {
    const head = await readView(file, offset, 16);
    let atomSize = head.getUint32(0);
    const type = atomType(head, 4);
    let headerLen = 8;
    if (atomSize === 1) {
      atomSize = Number(head.getBigUint64(8)); // 64-bit extended size
      headerLen = 16;
    } else if (atomSize === 0) {
      atomSize = size - offset; // extends to end of file
    }
    if (atomSize < headerLen) break; // malformed
    if (type === "moov") {
      moov = { start: offset + headerLen, end: offset + atomSize };
      break;
    }
    offset += atomSize;
  }
  if (!moov) return null;

  // Find mvhd within moov and read its creation_time.
  let childOffset = moov.start;
  while (childOffset + 8 <= moov.end) {
    const head = await readView(file, childOffset, 8);
    let atomSize = head.getUint32(0);
    const type = atomType(head, 4);
    if (atomSize === 1) {
      const ext = await readView(file, childOffset + 8, 8);
      atomSize = Number(ext.getBigUint64(0));
    } else if (atomSize === 0) {
      atomSize = moov.end - childOffset;
    }
    if (atomSize < 8) break;
    if (type === "mvhd") {
      const body = await readView(file, childOffset + 8, 12);
      const version = body.getUint8(0);
      const creationTime =
        version === 1 ? Number(body.getBigUint64(4)) : body.getUint32(4);
      return mp4TimeToDate(creationTime);
    }
    childOffset += atomSize;
  }
  return null;
}

/**
 * Best-effort capture date for a video: container creation_time first, then a
 * date embedded in the filename. Returns null when neither is available (the
 * caller then leaves the post date to fall back to upload time). We don't trust
 * file.lastModified here — for camera-roll videos it's often the export time.
 */
export async function getVideoDate(file: File): Promise<Date | null> {
  try {
    const fromMeta = await getVideoCreationDate(file);
    if (fromMeta) return fromMeta;
  } catch {
    // Unreadable/odd container — fall through to filename
  }
  return dateFromFilename(file.name);
}
