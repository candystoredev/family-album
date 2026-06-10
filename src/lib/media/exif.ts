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
