/** True for HEIC/HEIF, including the sequence variants and the common case of a
 *  missing/octet-stream MIME type where only the extension tells us. */
export function isHeic(file: File): boolean {
  const t = file.type.toLowerCase();
  if (t.startsWith("image/heic") || t.startsWith("image/heif")) return true;
  if (!t || t === "application/octet-stream") return /\.(heic|heif)$/i.test(file.name);
  return false;
}

const jpegName = (name: string) => name.replace(/\.[^.]+$/, ".jpg");

/**
 * Resize + JPEG-encode via canvas. Rejects (rather than silently returning the
 * original) when the browser can't decode the image, so the caller can fall
 * back. `forceReencode` makes even a small image round-trip through canvas —
 * needed for HEIC, which must become JPEG regardless of dimensions.
 */
function canvasCompress(
  file: File,
  maxPx: number,
  quality: number,
  forceReencode: boolean
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { naturalWidth: w, naturalHeight: h } = img;
      if (!w || !h) {
        reject(new Error("zero-size decode"));
        return;
      }
      if (!forceReencode && w <= maxPx && h <= maxPx) {
        resolve(file);
        return;
      }
      const scale = Math.min(1, maxPx / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("toBlob failed"));
            return;
          }
          resolve(new File([blob], jpegName(file.name), { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}

/** Decode HEIC to a JPEG File via libheif (WASM). Loaded lazily so the bundle
 *  only pays for it when a browser actually can't decode HEIC natively. */
async function heicToJpeg(file: File): Promise<File> {
  const heic2any = (await import("heic2any")).default;
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  const blob = Array.isArray(out) ? out[0] : out;
  return new File([blob], jpegName(file.name), { type: "image/jpeg" });
}

/**
 * Resize + JPEG-compress a photo client-side before upload.
 *
 * HEIC handling: Safari (the primary iPhone path) can decode HEIC in <img>, so
 * we try the native canvas path first and stay WASM-free there. On Chrome/
 * Firefox that decode fails — then, and only then, we fall back to a libheif
 * WASM decode and re-compress the resulting JPEG. Previously a HEIC on a
 * non-Safari browser hit img.onerror and was uploaded undecodable.
 *
 * Falls back to the original file on any unrecoverable error.
 */
export async function compressImage(file: File, maxPx = 1920, quality = 0.82): Promise<File> {
  const heic = isHeic(file);
  if (!file.type.startsWith("image/") && !heic) return file;

  try {
    // HEIC must always re-encode to JPEG; other images keep the small-file shortcut.
    return await canvasCompress(file, maxPx, quality, heic);
  } catch {
    if (heic) {
      try {
        const jpeg = await heicToJpeg(file);
        try {
          return await canvasCompress(jpeg, maxPx, quality, false);
        } catch {
          return jpeg; // converted but couldn't resize — the JPEG is still fine
        }
      } catch {
        return file; // conversion failed — let the upload proceed with the original
      }
    }
    return file; // non-HEIC decode failure — preserve prior behavior
  }
}
