"use client";

/**
 * In-browser OCR via tesseract.js — the model-free, fully-local half of the
 * enrichment pipeline. Nothing leaves the device; no API key involved. The
 * library (and its ~2MB English data file) is loaded lazily on first use so
 * the main bundle doesn't pay for it, and a single worker is reused for the
 * whole session.
 *
 * Accuracy expectations are deliberately modest: crisp printed text (flyers,
 * invitations, signs) reads well; stylized/handwritten text often doesn't.
 * The output feeds extractDatesFromText, whose validation drops anything that
 * isn't an unambiguous written date.
 */

type TesseractWorker = {
  recognize: (image: File | Blob) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;
let failed = false;

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return (await createWorker("eng")) as unknown as TesseractWorker;
    })();
  }
  return workerPromise;
}

/** OCR a (small) image File. Returns "" on any failure — OCR is best-effort
 *  garnish, never a blocker. After one hard init failure it stops retrying. */
export async function ocrText(image: File | Blob): Promise<string> {
  if (failed) return "";
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image as File);
    return data.text ?? "";
  } catch {
    // Worker init failures (CDN unreachable, unsupported browser) would
    // repeat for every photo — give up for the session.
    if (workerPromise) {
      workerPromise.then((w) => w.terminate()).catch(() => {});
    }
    workerPromise = null;
    failed = true;
    return "";
  }
}
