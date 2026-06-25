import exifr from "exifr";
import { parseAppleCreationDate } from "./capture-date";

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

interface Atom {
  type: string;
  /** byte offset of the atom's contents (after its size+type header) */
  contentStart: number;
  /** byte offset just past the atom */
  end: number;
  /** raw 32-bit value of the type field — for ilst items this is the key index */
  rawType: number;
}

/** List the child atoms within [start, end), reading only headers (not bodies). */
async function listAtoms(blob: Blob, start: number, end: number): Promise<Atom[]> {
  const atoms: Atom[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const head = await readView(blob, offset, 16);
    let atomSize = head.getUint32(0);
    const type = atomType(head, 4);
    const rawType = head.getUint32(4);
    let headerLen = 8;
    if (atomSize === 1) {
      atomSize = Number(head.getBigUint64(8)); // 64-bit extended size
      headerLen = 16;
    } else if (atomSize === 0) {
      atomSize = end - offset; // extends to the end
    }
    if (atomSize < headerLen) break; // malformed
    atoms.push({ type, contentStart: offset + headerLen, end: offset + atomSize, rawType });
    offset += atomSize;
  }
  return atoms;
}

/** Convert an MP4/MOV creation_time (seconds since 1904) to a Date. Keeps the
 *  full timestamp — the feed orders by the exact time, so same-day clips must
 *  retain their time-of-day. Returns null if implausible. */
function mp4TimeToDate(seconds: number): Date | null {
  if (!seconds) return null;
  const d = new Date((seconds - MP4_EPOCH_OFFSET) * 1000);
  const year = d.getUTCFullYear();
  if (isNaN(d.getTime()) || year < 1990 || year > 2100) return null;
  return d;
}

/** Parse an Apple creationdate string (e.g. "2026-06-22T18:03:00+0100"), which
 *  carries the local time AND its UTC offset, into an exact instant. The offset
 *  may lack a colon ("+0100"), which not all engines parse — normalize it. */
function parseAppleDate(raw: string): Date | null {
  const s = raw.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(s);
  const year = d.getFullYear();
  if (isNaN(d.getTime()) || year < 1990 || year > 2100) return null;
  return d;
}

/**
 * Apple writes the true local capture time + UTC offset in the QuickTime
 * metadata under the key "com.apple.quicktime.creationdate", stored via the
 * moov/meta `keys` (key names) + `ilst` (values) atoms. This is more accurate
 * than mvhd (which has no timezone) and needs no GPS→timezone lookup.
 *
 * Returns the RAW string (e.g. "2026-06-22T18:03:00+0100") so callers can keep
 * either just the instant (getVideoCreationDate) or the instant + offset
 * (getVideoCapture). Null if the key/value isn't present.
 */
async function readQuickTimeCreationRaw(
  blob: Blob,
  moov: { start: number; end: number }
): Promise<string | null> {
  const meta = (await listAtoms(blob, moov.start, moov.end)).find((a) => a.type === "meta");
  if (!meta) return null;

  // QuickTime `meta` is a plain container; the ISO variant prepends 4 bytes of
  // version/flags. Detect by checking which offset yields known child atoms.
  let children = await listAtoms(blob, meta.contentStart, meta.end);
  if (!children.some((c) => c.type === "keys" || c.type === "ilst")) {
    children = await listAtoms(blob, meta.contentStart + 4, meta.end);
  }
  const keys = children.find((c) => c.type === "keys");
  const ilst = children.find((c) => c.type === "ilst");
  if (!keys || !ilst) return null;

  // keys: version/flags(4), count(4), then [size(4), namespace(4), key-string].
  const keysDv = await readView(blob, keys.contentStart, keys.end - keys.contentStart);
  let targetIndex = -1;
  let p = 8;
  let index = 0;
  while (p + 8 <= keysDv.byteLength) {
    const entrySize = keysDv.getUint32(p);
    if (entrySize < 8 || p + entrySize > keysDv.byteLength) break;
    index++;
    let name = "";
    for (let j = p + 8; j < p + entrySize; j++) name += String.fromCharCode(keysDv.getUint8(j));
    if (name === "com.apple.quicktime.creationdate") {
      targetIndex = index;
      break;
    }
    p += entrySize;
  }
  if (targetIndex < 0) return null;

  // ilst: items whose 32-bit type field is the 1-based key index; each holds a
  // `data` atom of type(4)+locale(4)+value.
  for (const item of await listAtoms(blob, ilst.contentStart, ilst.end)) {
    if (item.rawType !== targetIndex) continue;
    const data = (await listAtoms(blob, item.contentStart, item.end)).find((d) => d.type === "data");
    if (!data) return null;
    const dv = await readView(blob, data.contentStart, Math.min(data.end - data.contentStart, 256));
    let value = "";
    for (let j = 8; j < dv.byteLength; j++) value += String.fromCharCode(dv.getUint8(j));
    return value;
  }
  return null;
}

/**
 * Locate the moov atom and read both the Apple creationdate (raw) and the mvhd
 * creation_time in one pass. Reads only atom headers/small values via Blob
 * slices, so it never loads the whole video.
 */
async function readVideoContainerTimes(
  file: Blob
): Promise<{ appleRaw: string | null; mvhd: Date | null }> {
  const moov = (await listAtoms(file, 0, file.size)).find((a) => a.type === "moov");
  if (!moov) return { appleRaw: null, mvhd: null };
  const moovRange = { start: moov.contentStart, end: moov.end };

  const appleRaw = await readQuickTimeCreationRaw(file, moovRange);

  let mvhd: Date | null = null;
  const mvhdAtom = (await listAtoms(file, moovRange.start, moovRange.end)).find(
    (a) => a.type === "mvhd"
  );
  if (mvhdAtom) {
    const body = await readView(file, mvhdAtom.contentStart, 12);
    const version = body.getUint8(0);
    const creationTime = version === 1 ? Number(body.getBigUint64(4)) : body.getUint32(4);
    mvhd = mp4TimeToDate(creationTime);
  }
  return { appleRaw, mvhd };
}

/**
 * Read the capture date from an MP4/MOV container as a bare instant. Prefers
 * Apple's "com.apple.quicktime.creationdate" (local time + UTC offset), falling
 * back to mvhd. Null if nothing is found. (Offset is discarded — use
 * getVideoCapture to keep it.)
 */
export async function getVideoCreationDate(file: Blob): Promise<Date | null> {
  const { appleRaw, mvhd } = await readVideoContainerTimes(file);
  if (appleRaw) {
    const parsed = parseAppleDate(appleRaw);
    if (parsed) return parsed;
  }
  return mvhd;
}

/**
 * Read the capture instant AND its UTC offset from an MP4/MOV container, for the
 * unified capture-date model. Apple's creationdate carries the offset; mvhd is
 * UTC-only (tzOffsetMin = null). Null if the container has neither.
 */
export async function getVideoCapture(
  file: Blob
): Promise<{ instant: string; tzOffsetMin: number | null } | null> {
  const { appleRaw, mvhd } = await readVideoContainerTimes(file);
  if (appleRaw) {
    const parsed = parseAppleCreationDate(appleRaw);
    if (parsed) return parsed;
  }
  if (mvhd) return { instant: mvhd.toISOString(), tzOffsetMin: null };
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
