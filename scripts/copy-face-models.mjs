#!/usr/bin/env node
/**
 * Stage the face-recognition model weights into public/models so the browser
 * fetches them SAME-ORIGIN at runtime.
 *
 * Why a build step instead of committing the files: the weights already ship
 * inside the @vladmandic/face-api dependency (~6.7 MB), so committing a second
 * copy would bloat git history forever. And they can't be loaded from a CDN —
 * the app's CSP is `connect-src 'self' + R2` (see next.config.ts), so the
 * weights must come from our own origin.
 *
 * Runs automatically via the `prebuild`/`predev` npm lifecycle hooks. Fails
 * loudly: a silent miss here would make face detection 404 at runtime and look
 * like "no faces found" rather than a broken deploy.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@vladmandic", "face-api", "model");
const dest = join(root, "public", "models");

// Only the three nets detect.ts actually loads — not the whole model dir.
const MODELS = ["tiny_face_detector", "face_landmark_68", "face_recognition"];

if (!existsSync(src)) {
  console.error(
    `[face-models] Missing ${src}\n` +
      `Install dependencies first (npm install) — @vladmandic/face-api ships the weights.`
  );
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

let copied = 0;
for (const model of MODELS) {
  for (const file of [`${model}_model-weights_manifest.json`, `${model}_model.bin`]) {
    const from = join(src, file);
    if (!existsSync(from)) {
      console.error(`[face-models] Expected weight file missing: ${from}`);
      process.exit(1);
    }
    copyFileSync(from, join(dest, file));
    copied++;
  }
}

console.log(`[face-models] Staged ${copied} weight files → public/models`);
