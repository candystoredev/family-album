/**
 * Server-side cap on the ORIGINAL photo upload size, in bytes.
 *
 * Enforced for real in `src/app/api/admin/upload/complete/route.ts` (a
 * modified/older client or a direct API call must not be able to bypass it).
 * `src/app/admin/upload/page.tsx` imports this same constant to reject
 * oversized photos earlier, with a friendlier message, before spending time
 * compressing/hashing/uploading them.
 *
 * Deliberately its own tiny, dependency-free module (rather than living in
 * `process-photo.ts`) so the "use client" upload page can import it without
 * pulling `sharp` — a server-only native module — into the browser bundle.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
