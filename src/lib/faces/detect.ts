"use client";

/**
 * In-browser face detection + 128-d embeddings via @vladmandic/face-api — the
 * local, private half of the Faces → People pipeline. Nothing leaves the
 * device: the model weights are served same-origin from /public/models (bundled
 * at build time, never a CDN, so the strict CSP is satisfied) and detection
 * runs on the TensorFlow.js WebGL backend (no WebAssembly → no need for
 * 'wasm-unsafe-eval' in script-src).
 *
 * Same shape as ocr.ts: the ~7 MB of weights load lazily on first use and are
 * reused for the whole session, and any hard init failure disables the feature
 * for the session rather than retrying per-photo. Face detection is best-effort
 * garnish — it must never block publishing or the archive scan.
 */

import type { DetectedFace } from "./types";

const MODEL_URL = "/models";

type FaceApi = typeof import("@vladmandic/face-api");

let apiPromise: Promise<FaceApi> | null = null;
let failed = false;

async function getApi(): Promise<FaceApi> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      // The bundled tf re-export isn't fully typed for backend control — narrow
      // to just the calls we make.
      const tf = faceapi.tf as unknown as {
        setBackend: (name: string) => Promise<boolean>;
        ready: () => Promise<void>;
      };
      // Prefer WebGL (fast, no eval); fall back to the pure-JS CPU backend if
      // WebGL is unavailable. Never 'wasm' — that would need a CSP exception.
      try {
        await tf.setBackend("webgl");
      } catch {
        await tf.setBackend("cpu");
      }
      await tf.ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })();
  }
  return apiPromise;
}

/** True once a hard init failure has disabled detection for this session. */
export function faceDetectionFailed(): boolean {
  return failed;
}

function detectorOptions(faceapi: FaceApi) {
  return new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
}

function inputSize(input: HTMLImageElement | HTMLCanvasElement): { w: number; h: number } {
  if (input instanceof HTMLImageElement) {
    return { w: input.naturalWidth || input.width, h: input.naturalHeight || input.height };
  }
  return { w: input.width, h: input.height };
}

/**
 * Detect every face in an already-decoded image or canvas and return each with
 * a normalized (0..1) box and its descriptor as a plain number[]. Returns [] on
 * any failure — detection is never a blocker. After one hard init failure it
 * stops retrying for the session.
 */
export async function detectFaces(
  input: HTMLImageElement | HTMLCanvasElement
): Promise<DetectedFace[]> {
  if (failed) return [];

  // Init failure (no WebGL, weights unreachable) WOULD repeat for every image,
  // so it disables the feature for the session. A failure while running
  // inference on one image (a corrupt decode, a transient WebGL context loss)
  // must NOT — that would kill an archive scan, and compose-time suggestions,
  // over a single bad photo. The two are caught separately.
  let faceapi: FaceApi;
  try {
    faceapi = await getApi();
  } catch {
    failed = true;
    apiPromise = null;
    return [];
  }

  try {
    const { w, h } = inputSize(input);
    if (!w || !h) return [];
    const results = await faceapi
      .detectAllFaces(input, detectorOptions(faceapi))
      .withFaceLandmarks()
      .withFaceDescriptors();

    return results.map((r) => {
      const { x, y, width, height } = r.detection.box;
      return {
        box: {
          x: clamp01(x / w),
          y: clamp01(y / h),
          w: clamp01(width / w),
          h: clamp01(height / h),
        },
        descriptor: Array.from(r.descriptor),
        score: r.detection.score,
      };
    });
  } catch {
    // This image only — the model stays loaded and usable.
    return [];
  }
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Decode a Blob/File into an <img> ready for {@link detectFaces}. */
export async function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Revoke on the next tick so decode() has resolved with pixels retained.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Load a same-origin image URL (e.g. the scan proxy) as a CORS-clean <img>. */
export async function imageFromUrl(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  return img;
}
