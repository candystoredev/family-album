# Decisions

## Stack & Infrastructure

### 2025-01-01
Decision: Host on Vercel free tier
Reason: Smoother Next.js support, auto-deploy from GitHub
Alternatives Considered: Self-hosting, Netlify, Cloudflare Pages
Impact: Imposes 10-second function timeout, 4.5MB body limit, 1,000 image optimizations/month

### 2025-01-01
Decision: Use Cloudflare R2 for media storage
Reason: Zero egress fees — critical for a media-heavy site
Alternatives Considered: AWS S3, Cloudflare Images, Vercel Blob
Impact: ~$0-2/month even at scale; requires S3-compatible SDK

### 2025-01-01
Decision: Use Turso (SQLite) for database
Reason: Simple, free tier, FTS5 built-in for search
Alternatives Considered: PlanetScale, Supabase, Neon
Impact: Embedded full-text search with no additional service

### 2025-01-01
Decision: Next.js App Router + Tailwind CSS for frontend
Reason: Modern SSR, dark theme from start, good Vercel integration
Alternatives Considered: Remix, Astro, plain React SPA
Impact: App Router patterns for data fetching and routing

## Media & Performance

### 2025-01-01
Decision: Pre-generate thumbnails via `sharp` stored in R2 (not Vercel Image Optimization)
Reason: Vercel free tier caps at 1,000 optimizations/month — far too low for a photo site
Alternatives Considered: Vercel Image Optimization, Cloudflare Image Resizing, client-side resize
Impact: Server-side `sharp` after upload; thumbnails served directly from R2 CDN

### 2025-01-01
Decision: Presigned R2 URLs for uploads
Reason: Bypasses Vercel 4.5MB body limit; direct client-to-R2 upload
Alternatives Considered: Server-side proxy upload, chunked upload
Impact: Two-step flow (get presigned URL, then upload to R2, then create post)

### 2025-01-01
Decision: Direct R2 serve for video, no transcoding
Reason: No cost or latency for encoding; modern devices handle MP4 natively
Alternatives Considered: Cloudflare Stream, Mux, server-side ffmpeg
Impact: Video quality depends on source; no adaptive bitrate

### 2025-01-01
Decision: R2 key convention `media/{media_id}/original.{ext}` with per-asset directories
Reason: Clean, extensible — future variants added as sibling files without schema changes
Alternatives Considered: Flat key structure, hash-based paths
Impact: Supports multiple sizes, format conversion later

### 2025-01-01
Decision: Server-side `sharp` for thumbnails after R2 upload (not client-side)
Reason: Future-proof — supports multiple sizes, format conversion, smart cropping later
Alternatives Considered: Client-side resize before upload, on-demand resize
Impact: Slight server-side cost per upload but consistent quality and flexibility

## Identity & URLs

### 2025-01-01
Decision: nanoid for all primary keys (non-sequential random strings)
Reason: Post pages are publicly accessible for OG previews; sequential IDs would make archive scrapeable
Alternatives Considered: Auto-increment integer, UUID, cuid
Impact: All PKs are text type; URL-safe by default

### 2025-01-01
Decision: Slug-based post URLs (`/posts/happy-steaksgiving`)
Reason: Human-readable, better iMessage preview cards
Alternatives Considered: ID-based URLs, date-based URLs
Impact: Slug dedup logic needed (suffix `-2`, `-3`); untitled posts use date-based fallback

## Authentication & Privacy

### 2025-01-01
Decision: Session JWT / cookie-based auth for browsers
Reason: Simple family access, no external auth provider needed
Alternatives Considered: OAuth, passkeys, magic links
Impact: 90-day session cookies; dual login (viewer vs admin)

### 2025-01-01
Decision: Bearer token for API/iOS Shortcut auth
Reason: iOS Shortcut requirement — simple header-based auth
Alternatives Considered: OAuth, API keys with rotation
Impact: Single ADMIN_API_TOKEN env var; no rotation mechanism in v1

### 2025-01-01
Decision: Invite links + shared password fallback for viewer access
Reason: Invite links for frictionless family access; password for direct visitors
Alternatives Considered: Invite-only (no password), individual accounts, public with obscurity
Impact: Admin manages invite links (label, expire, revoke) + single shared password

### 2025-01-01
Decision: bcrypt for password hashing, stored in `site_settings`
Reason: Industry standard; never store plaintext passwords
Alternatives Considered: argon2, scrypt
Impact: bcryptjs dependency; hash-on-set, compare-on-login pattern

### 2025-01-01
Decision: `robots.txt` + `noindex` meta + `X-Robots-Tag` header for crawler blocking
Reason: Post pages must be publicly accessible for iMessage OG previews but not indexed by search engines
Alternatives Considered: Auth-wall everything (breaks OG previews), Cloudflare WAF rules
Impact: Three-layer defense; iMessage/social crawlers intentionally bypass (desired behavior)

## Content & UX

### 2025-01-01
Decision: No comments — iMessage feedback instead
Reason: Privacy, no moderation burden, natural family conversation
Alternatives Considered: Built-in comments, Disqus, email notifications
Impact: Pre-filled `sms:` URI with post URL; phone numbers stored in DB settings

### 2025-01-01
Decision: No Tumblr URL redirects — let old URLs 404
Reason: Clean break, no redirect maintenance
Alternatives Considered: 301 redirects from Tumblr URL patterns
Impact: Any existing Tumblr links will break

### 2025-01-01
Decision: Responsive web for admin (not PWA)
Reason: PWA on iOS is unreliable
Alternatives Considered: PWA, native iOS app
Impact: Admin works in browser; iOS Shortcut handles mobile uploads
**SUPERSEDED (2026-06):** shipped an installable iOS **standalone PWA** (manifest + service worker, gold monogram icon, auto-refresh on re-foreground) — required for Web Push (daily "On this day" notifications only fire from an installed PWA on iOS).

### 2025-01-01
Decision: Cursor-based infinite scroll for pagination
Reason: Correct for chronological feeds; offset-based skips posts on insert
Alternatives Considered: Offset-based pagination, page numbers
Impact: Home feed newest-first; month pages oldest-first (different cursor directions)

### 2025-01-01
Decision: Dark theme matching Tumblr concept but refined
Reason: Keep the feel families are used to, modernize execution
Alternatives Considered: Light theme, theme toggle
Impact: Consistent dark theme throughout; photos pop against dark background

## Migration

### 2025-01-01
Decision: Use Tumblr API as migration source (not scraping)
Reason: Official, complete, preserves all metadata
Alternatives Considered: Web scraping, Tumblr export file
Impact: OAuth credentials required; handles all post types

### 2025-01-01
Decision: Use Tumblr timestamps for post dates (not EXIF)
Reason: Tumblr strips EXIF from uploads
Alternatives Considered: Re-derive from filename patterns
Impact: Dates accurate to Tumblr posting time, not photo capture time

### 2025-01-01
Decision: Pre-defined people list for migration tag routing
Reason: Deterministic — Tom provides names, script maps matching tags
Alternatives Considered: AI-based name detection, manual post-migration assignment
Impact: Migration config contains people array; matches route to `people` table, rest to `tags`

### 2025-01-01
Decision: FTS5 external content mode with rowid backing
Reason: Standard SQLite approach for FTS5 with non-integer PKs (nanoid text PK)
Alternatives Considered: Regular FTS5 table, separate search index
Impact: Requires sync triggers on INSERT/UPDATE/DELETE; content_rowid=rowid (implicit integer)
**SUPERSEDED (as-built):** implemented instead as a **standalone** FTS5 table (`posts_fts` with `post_id UNINDEXED`), synced at application level — incremental INSERT/DELETE on post create/edit/delete, full `rebuildFtsIndex()` from `/api/init`. No triggers. (Caveat until Phase 12c: incremental writes index `body` as empty string.)

### 2025-01-01
Decision: Project lives at `apps/thehoecks/` in the monorepo
Reason: Alongside other apps in `tom-playground` monorepo
Alternatives Considered: Separate repository, root-level project
Impact: Vercel root directory set to `apps/thehoecks`; deploy workflow scoped to `apps/**`
**SUPERSEDED (2026-06):** extracted to its own repo `candystoredev/family-album`; source now at repo root `src/...`, Vercel root directory is `/`.

### 2025-01-01
Decision: EXIF date extraction on new posts via iOS (not server)
Reason: iOS natively provides EXIF data; avoids server-side EXIF parsing
Alternatives Considered: Server-side EXIF extraction after upload
Impact: iOS Shortcut pre-fills post date from EXIF; admin panel allows manual date override
**EXTENDED (2026-06):** the web upload form extracts the capture date client-side from the *original* before compression — photos via `exifr` (EXIF), videos via in-browser MP4/MOV container parsing (`mvhd` + Apple `creationdate`). Server EXIF fallback exists for photos. See the 2026-06 decisions below.

### 2025-01-01
Decision: Admin settings stored in DB `site_settings` table, not env vars
Reason: Change password, manage invites, update iMessage numbers — no redeploy needed
Alternatives Considered: Environment variables for all settings, config file
Impact: Admin panel settings page required; viewer password, iMessage recipients, site metadata all runtime-changeable

## Bulk Import (Phase 9)

### 2026-05-15
Decision: Timestamp-gap grouping only for bulk import auto-grouping (no content-based ML)
Reason: Content-based clustering requires either client-side ML (heavy, slow, unreliable on older iPads) or a paid vision API (off-limits on free tier). Timestamp proximity alone handles the primary use case — photos from the same event cluster naturally within a 1-hour gap.
Alternatives Considered: TensorFlow.js for client-side scene similarity; perceptual hashing for near-duplicate detection; OpenAI/Google Vision API
Impact: V1 grouping is timestamp-only. Perceptual hashing for burst-shot deduplication remains a future option if needed.

### 2026-05-15
Decision: `exifr` library for client-side EXIF extraction in bulk import
Reason: Lightweight, browser-native, no server round-trip before grouping. Avoids sending files to Vercel just to read metadata.
Alternatives Considered: Server-side `exiftool` or `sharp` metadata extraction
Impact: EXIF parsing happens before any network activity; grouping UI is instant.

### 2026-05-15
Decision: Zoom control uses CSS `--bulk-cols` custom property; pinch handled via `wheel`+`ctrlKey` (trackpad) and `touchmove` distance (touchscreen)
Reason: `wheel` with `ctrlKey` is the standard browser signal for trackpad pinch. Combining with touch distance handles iPads. Both adjust the same CSS variable so there's one source of truth for layout.
Alternatives Considered: CSS `transform: scale()` on cards (breaks drag-and-drop hit targets); third-party gesture library
Impact: Must call `preventDefault()` on `wheel`+`ctrlKey` within the bulk import page to suppress browser zoom; scoped to that page only.

### 2026-06-10
Decision: Sub-phases resequenced — merge/split buttons ship in 9a, cross-group drag-and-drop deferred to 9d (polish)
Reason: Gap-threshold misfires are almost always "two groups should be one" or "one group should be two." A merge button and a split divider fix both with zero dnd complexity, so a complete end-to-end tool ships after three sub-phases instead of five.
Alternatives Considered: Original order (dnd in 9b before metadata/publish)
Impact: 9-pre→9c is the MVP; 9d/9e are independent polish that can slip without blocking use.

### 2026-06-10
Decision: Bulk import drag-and-drop is group membership + linear order only; row layout inside groups is always auto-generated
Reason: The upload form's drag is custom pointer hit-testing against `[data-row]`/`[data-item]` (not `@dnd-kit` SortableContext, contrary to what the original plan assumed) — built for row-level placement that doesn't generalize to 30 cards. At bulk-review scale, only membership matters; the edit page already covers per-post layout.
Alternatives Considered: Porting the custom row hit-test to multi-container; full SortableContext nesting with row semantics
Impact: 9d uses the standard dnd-kit multi-container pattern (droppable cards, per-group `SortableContext`). `defaultLayout`/`generatePhotosetLayout` move to a shared `lib/media/layout.ts`.
**SUPERSEDED (2026-06-10, below):** reversed once the limited layouts proved too constraining in real use.

### 2026-06-10
Decision: Bulk import DOES support per-group row layout — port the upload page's row-level drag (supersedes the prior "membership + linear order only" decision)
Reason: In real use, auto-only layouts were too limiting (e.g. a 4-photo group is locked to 2×2 with no way to make a hero 1+3). The backend already accepts a custom `photosetLayout`, so the cost was front-end only.
Alternatives Considered: Row-break toggle buttons; a preset layout picker (doesn't scale past a few photos); deferring to the edit page
Impact: Group model became `itemIds` + `layout: number[]` (row sizes). Drag is `@dnd-kit` `useDraggable` + a **synchronous** global `pointermove` hit-test across all groups/rows + the new-group zone (rAF was unreliable — paused in backgrounded tabs), with a pure `computeDisplay` for live preview and commit. Replaced 9d's initial `SortableContext`/`useSortable` approach. Publish sends `layout.join("")` as `photosetLayout`.

### 2026-06-10
Decision: 9d collision detection is pointer-first only for the new-group zone, `closestCorners` for everything else (not `rectIntersection` as originally planned); new groups created via a dedicated drop tile, not positional gaps between cards
Reason: `rectIntersection` makes within-group reordering jumpy, and `pointerWithin` as the sole strategy made `over` resolve to the container instead of the hovered photo (breaking same-group reorder). `closestCorners` reliably targets the nearest photo for reorder and the nearest card for cross-group moves. Positional "gaps between cards" don't map cleanly onto a wrapping CSS grid, so a single dashed drop tile at the end of the grid is the new-group affordance — group order in the review view doesn't affect published posts (each has its own date), so "at the end" is fine.
Alternatives Considered: `rectIntersection` (jumpy reorder); pure `pointerWithin` (broke reorder target); interleaved gap droppables in the grid (layout-fragile)
Impact: Cross-group moves happen live in `onDragOver`; `onDragEnd` finalizes same-group reorder, new-group extraction, and prunes emptied groups. Dropping a group's only photo on the new-group tile is a no-op to preserve that group's metadata.

### 2026-06-10
Decision: Previews are ≤320px generated thumbnails (`createImageBitmap` with `resizeWidth`); original files are never rendered into the DOM
Reason: 200 full-resolution object-URL decodes consume GBs of RAM and kill the tab. Memory, not network, is the scaling constraint for bulk import.
Alternatives Considered: Object URLs of originals (current upload-form pattern — fine at 1–10 files, fatal at 200)
Impact: Two-pass ingest (EXIF first, thumbs progressively); `content-visibility: auto` on cards.

### 2026-06-10
Decision: Compression runs lazily at upload time (pipelined per group); the group's date is always passed explicitly to the complete endpoint
Reason: Eagerly compressing 200 files on selection freezes the tab. Separately, canvas re-encoding strips EXIF, so server-side date detection cannot work on compressed uploads — this is a standing bug in the single upload form (photos >1920px silently get the upload date). Client-side EXIF extraction (needed for grouping anyway) fixes both.
Alternatives Considered: Eager compression on file selection; preserving EXIF through re-encode (no clean browser API)
Impact: 9-pre extracts a shared `lib/media/exif.ts` and fixes the single-upload date bug as a side effect. Publish pipeline is per-group with no global upload/publish barrier (caps: 5 PUTs, 3 completes).

### 2026-06-10
Decision: Grouping threshold is a live segmented control (1 hr / 6 hrs / 1 day) that locks after the first manual group edit
Reason: Regrouping is a pure recompute — letting the admin watch groups reflow beats a hardcoded constant and eliminates most manual merge/split work. Locking after manual edits prevents the control from destroying them.
Alternatives Considered: Hardcoded 1-hour constant (original plan); free-form threshold input
Impact: `groupByGap(items, thresholdMs)` is a pure, unit-tested function in `lib/media/grouping.ts`.

### 2026-06-10
Decision: Zoom-responsive card content via CSS container queries (Tailwind v4 `@container`), not JS branching on column count
Reason: Card layout should respond to the card's own width — one markup serves every zoom level, and the slider/pinch only ever touches `--bulk-cols`.
Alternatives Considered: Conditional rendering keyed on the column-count state
Impact: Metadata collapse threshold lives in CSS (~280px card width).

### 2026-06-10
Decision: iOS Safari `h-full` fix — single-photo rows use `h-auto` + stored `aspect-ratio`; multi-photo rows keep `h-full` + `aspect-ratio: 4/3`
Reason: Safari resolves `h-full` to 0 when the flex container has no explicit height (auto-height chain). Chrome uses the intrinsic size as a fallback; Safari does not. Single-photo rows in multi-photo posts (layout "31") were invisible on iPhone.
Alternatives Considered: Explicit pixel height on the flex container; CSS `min-height` trick; setting aspect-ratio on the container instead of the image
Impact: `PhotoGrid.tsx` branches on `count > 1`. Single-row images require stored `width`/`height` in the DB — already present for all photos from the sharp processing step.

### 2026-06-10
Decision: Bulk import publish pipeline uses concurrency 2 groups in parallel (not separate caps for PUTs vs completes)
Reason: A simple `runPool(groups, 2, publishGroup)` is easier to reason about and avoids backpressure complexity. Photos within each group still upload in parallel, so the effective parallelism is adequate. The original plan's "5 PUTs, 3 completes" cap was premature optimization.
Alternatives Considered: Original plan: separate pools for PUT (5) and complete (3); sequential per-group
Impact: At most 2 `complete` calls and ~2×N simultaneous PUTs at any time. For batches of 5–20 groups this is indistinguishable from higher concurrency.

## 2026-06 — On This Day, Notifications, Share, Design, Video dates

### 2026-06
Decision: Daily "On this day" push notifications via Web Push (VAPID), gated behind the installed iOS PWA
Reason: A gentle daily memory teaser is the emotional core of the album; Web Push is free and needs no app store. iOS only exposes `PushManager` to a Home-Screen-installed PWA.
Alternatives Considered: Email digests, SMS/iMessage push, native app
Impact: `push_subscriptions` table, `/api/notifications/{subscribe,unsubscribe,test,daily}`, a daily cron (GitHub Actions → `/api/notifications/daily`, `CRON_SECRET`), admin send-hour/timezone settings, a Settings page with a per-device toggle. `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` env vars; `web-push` dependency.

### 2026-06
Decision: One shared memory selector — `getMemoriesForDate(month, day, year, limit, maxPerYear)` — for the homepage teaser, the push notification, and the `/today` page
Reason: All three should agree on "what happened on this day." Differences are just limits: teaser + notification = 3; `/today` = 6. Only previous years (`< year`) are included, so a pinned/shared day never shows later-year posts.
Alternatives Considered: Separate queries per surface (drifted out of sync)
Impact: `lib/onThisDay.ts`; `/today` accepts an internal `?date=` for deep-linking; "X years ago" anchors to the page's reference year.

### 2026-06
Decision: Share an "On this day" via an **unguessable token link** (`/m/[token]`), not a date-bearing URL
Reason: `/today?date=YYYY-MM-DD` is guessable/enumerable; making it public would expose every day. A random token reveals nothing, previews in iMessage (OG tags), opens without the family login, and is stable/persistent.
Alternatives Considered: Make `/today` public (guessable); preview-only with gated body (recipients can't view); GPS→timezone (wrong tool)
Impact: `day_share_links` table (lazy `ensureDayShareSchema`, mirrors `post_share_links`), `/m` public in middleware, `POST /api/share/day` requires a session to mint. GPS/precise location must never be exposed on public `/m/` pages.

### 2026-06
Decision: Read video capture date from the container; prefer Apple `com.apple.quicktime.creationdate` over `mvhd`
Reason: Videos carry no EXIF; `mvhd` has no timezone, but Apple's `creationdate` embeds the local time + UTC offset — more accurate than `mvhd` and avoids any GPS→timezone lookup. Keep the full timestamp (not noon) so same-day clips order correctly.
Alternatives Considered: `file.lastModified` (export time, unreliable); reverse-geocode GPS to a timezone (needs a big dataset/API); noon-normalize (breaks same-day ordering)
Impact: dependency-free atom parser in `lib/media/exif.ts` (reads only headers/small values via `Blob.slice`); fixes the "video dated to upload time" bug.

### 2026-06
Decision: "Keepsake" gold design pass scoped to the **chrome only**; add `Source Serif 4`
Reason: A warmer, more premium feel for nav/settings/upload without touching the content surfaces. The gold (`#c2a467`, from the app icon) + serif display voice + faint paper grain read as a family keepsake.
Alternatives Considered: Gold app-wide; no new font; full restyle
Impact: Nav/Settings/Upload use gold + serif; feed/lightbox/post/login keep blue `#427ea3`. Canvas `#1a1918`. `next/font` adds Source Serif 4 alongside Source Sans 3.

### 2026-06
Decision: Timeline layout (classic list vs year rail) is a user preference shared between Settings and the nav via `localStorage` + a custom window event
Reason: `ArchiveMenu` (root layout) and `SettingsClient` (`/settings`) never share a React tree; `localStorage` key `hoecks_timeline` plus a `hoecks_timeline_change` event keeps them in sync live without a store or server round-trip.
Alternatives Considered: Server-persisted user pref; React context (no shared tree); URL param
Impact: `lib/useTimelineStyle.ts`; the nav FAB "albums/timeline" toggle and the Settings segmented control both drive it.

### 2026-06
Decision: Adopt the Rich Media Metadata plan (Phase 10) — capture more than we model, never overwrite, separate ordering (instant) from grouping (local date)
Reason: Today dates collapse to one tz-less string read three ways; videos/photos diverge; undated media defaults to upload time. Future features (map, dedup, semantic search, faces) need richer, durable per-item data.
Alternatives Considered: Spot-fix timezone only; do nothing
Impact: Full plan in `docs/rich-metadata-plan.md`; roadmap Phase 10. Schema additions are additive/nullable; historical backfill is a separate, opt-in track via perceptual-hash matching to local originals (Apple Photos/Dropbox/iCloud/etc.).

## 2026-07-09 — App review & roadmap restructure

### 2026-07-09
Decision: Bank untouched full-resolution originals in R2 (`originals/` prefix, never served) — forward at upload (Phase 11c) + historical via backfill (Phase 10.3d)
Reason: client-side compression (1920px JPEG q0.82) permanently discards the full-res original before R2 ever sees it — a quiet, irreversible quality loss for a keepsake archive. The original file is the ultimate metadata record. R2 cost is trivial (~$0.015/GB, zero egress).
Alternatives Considered: Keep discarding (status quo); archive only going forward (loses historical); external cold storage (new vendor)
Impact: Presign a second key per upload; `original_r2_key` on media; enables future "full-res on zoom" in the lightbox; allows the served copy to be safely re-encoded/GPS-stripped (11d)

### 2026-07-09
Decision: Feed keeps serving full-size stored images; no default downsizing. srcset only if cellular scroll ever hurts (Phase 14), and never in the lightbox
Reason: R2 egress is free, so large images cost nothing but load time; the family explicitly values pinch-zoom detail (the Lightbox has purpose-built pinch handling and serves originals; the page viewport also allows pinch). Serving originals in the feed was a deliberate Phase 4h quality decision.
Alternatives Considered: ~1080px feed variant (softer under page pinch-zoom); next/image (Vercel optimization cap)
Impact: Reverses the review's initial recommendation; image-perf work is demand-driven, not scheduled

### 2026-07-09
Decision: Share links stay persistent (no auto-expiry) but become revocable — `revoked` flag + admin list/revoke UI (Phase 11e)
Reason: old iMessage links must keep working (upholds the 2026-06 "stable/persistent" decision); revocation alone covers the leak scenario.
Alternatives Considered: Auto-expiry (breaks old family links); per-link TTL choice (complexity)
Impact: `revoked` column on `post_share_links` + `day_share_links`; small admin UI

### 2026-07-09
Decision: Cut invite links entirely; drop the dead `invite_links` table (Phase 13)
Reason: documented since v1 as a core viewer-auth path but never implemented — no route, no UI, not in middleware, 18 months unused. Shared password + share links cover the real use cases.
Alternatives Considered: Build it (no demand); leave the dead table (schema noise)
Impact: ARCHITECTURE auth section corrected; trivial to rebuild later if ever wanted

### 2026-07-09
Decision: One `/admin/review` surface (Phase 10.3c) merges three planned features: backfill ambiguous-match confirmation, post flagging/review queue (old 5d-flag), and estimated-date quick-fix (10.2c's loose end)
Reason: three queues, one UI pattern; 10.3 needs the confirm flow anyway.
Impact: 5d-flag retired as a standalone phase; review UI ships with the backfill

### 2026-07-09
Decision: Defer feed-query index work to the post-backfill audited "promote" step (Phase 10.3e); no interim generated columns or expression indexes
Reason: the read-time COALESCE (`lib/order.ts`) is non-sargable (full scan + filesort per feed page) but the scan is milliseconds at current scale; SQLite cannot `ALTER TABLE ADD` a STORED generated column; the promote step was already planned and makes ordering columns real + indexable.
Alternatives Considered: Expression indexes now (must match expressions exactly, adds migration surface); VIRTUAL generated columns (indexable but more moving parts)
Impact: Perf work lands exactly once, after backfill coverage makes it meaningful

### 2026-07-09
Decision: Retire roadmap Phases 5–8 as written; rewrite Phase 6 (iOS Shortcut) around the real endpoints
Reason: Phase 5 mostly shipped via other routes (`/settings`); 5e/5f/5g (tech-stack page, changelog, admin tabs) add no value over the docs; Phase 7 was a grab-bag (absorbed into 12/14); Phase 8 happened; the documented `POST /api/posts` never existed — the real flow is presign → direct R2 PUT → `/api/admin/upload/complete`, plus the shipped `/api/admin/upload/ingest-fetch` share-to-upload route.
Impact: ROADMAP restructured to Phases 11–14 around the Phase 10 spine

## 2026-07-11 — Phases 11–13 shipped; backfill Indexer built

### 2026-07-11
Decision: Defer 11c (bank full-res originals at upload); fold "bank originals" into the 10.3d backfill instead
Reason: Banking the untouched original at upload adds a private THIRD copy per photo (thumb + 1920px served + full-res original), needs its own private storage (the served media bucket is public, so GPS-bearing originals can't live there), and changes the client upload flow in two pages. But newly-uploaded photos still exist at full resolution in the family's photo library, which the 10.3 Indexer already walks — so 10.3d can archive those originals during the backfill with near-zero loss and no upload-path risk. Only a photo deleted from the library before the backfill runs would be missed.
Alternatives Considered: Build 11c now with a dedicated private `thehoecks-originals` bucket; build 11c now reusing the `thehoecks-backups` bucket under an `originals/` prefix (no new bucket); store originals in the public media bucket (rejected — undermines 11d's GPS strip).
Impact: Phase 11 completes as 11a/11b/11d/11e; 10.3d becomes the single home for banking originals (historical + going-forward), targeting the private `thehoecks-backups` bucket under `originals/`. Note the backups bucket holds the DB dump, not images — originals would be a separate prefix in the same private bucket.

### 2026-07-11
Decision: 11d strips EXIF/GPS from the SERVED photo only; videos are left as-is
Reason: The complete route never downloads video bytes (direct R2 serve, no transcoding — a standing architecture decision), so stripping video-container GPS would require adding server-side ffmpeg. Not worth it for the photo-dominant leak; photos are the concrete exposure (home coordinates in served JPEGs). The served video remaining metadata-bearing is an accepted, documented limitation.
Alternatives Considered: Add ffmpeg to strip video metadata (rejected — cost/latency, contradicts the no-transcoding decision); block geotagged video uploads (too blunt).
Impact: `lib/media/process-photo.ts` always re-encodes served photos; a code comment + ROADMAP note record the video limitation for a future ffmpeg-based pass if ever wanted.

### 2026-07-11
Decision: The backfill Indexer computes its perceptual hash with pyvips (the same libvips sharp wraps), reproducing the app's `perceptualHash` byte-for-byte — not a generic phash library
Reason: Tool B matches local originals to the album's stored thumbnails by perceptual hash; that only works if both sides compute the SAME hash. Different imaging stacks disagree on greyscale weights (libvips uses linear-light Rec.709, PIL uses Rec.601), resize kernels, and JPEG shrink-on-load. Using the same libvips guarantees parity with a plain `pip install pyvips[binary]` (no system packages); verified byte-identical against the real TS code via a `tsx` oracle.
Alternatives Considered: `imagehash`/other phash libs (different algorithm — won't match); approximate + widen the matcher's Hamming threshold (loses precision, more false matches); Pillow-only (kept as a fallback but flagged `phash_engine='pillow-fallback'` since it's ~close, not exact).
Impact: `tools/backfill-indexer/indexer/phash.py`; the parity is a load-bearing invariant for 10.3b — a Pillow-fallback run is never silent.

### 2026-07-11
Decision: Gate the cold-start schema DDL sweeps behind `PRAGMA user_version` rather than restructuring them (13b)
Reason: The four `ensure*Schema()` functions re-ran ~50 guarded `ALTER TABLE` statements on every serverless cold start. A `user_version` fast-path skips them once the DB is current, with minimal change and no new failure surface. Safe because `initializeSchema()` (`/api/init`) applies EVERYTHING the ensure* functions manage before stamping the version — including `ensureDayShareSchema()` (`day_share_links` was the one table that lived only in a lazy function). Fresh and existing prod DBs both keep running full idempotent DDL until `/api/init` stamps `SCHEMA_VERSION`, so neither can be left half-migrated.
Alternatives Considered: Full restructure into one migration list (more risk); leave as-is (wasteful cold starts); per-function version columns (over-engineered).
Impact: `SCHEMA_VERSION=1` in `schema.ts`; bump it + extend `initializeSchema()` whenever a new schema object is added. Perf benefit kicks in after the first `/api/init` post-deploy.

### 2026-07-11
Decision: Unify the 4 feed-enrichment copies into `src/lib/postAssembly.ts`, but preserve each caller's video-thumbnail fallback via an option rather than standardizing it (12d)
Reason: The "attach media/tags/people" block was duplicated across the SSR feed, `/api/feed`, `/api/search`, and on-this-day, and had drifted (`display_order` present in some). Centralizing removes the drift. A SECOND, unflagged drift surfaced during the refactor — feed paths use `""` for a thumbnail-less video (a video URL as a `<video>` poster renders black), search/on-this-day fall back to the media URL. Changing that silently could regress rendering, so it's preserved per-caller behind a `videoThumbnailFallback` option; the refactor is otherwise behavior-preserving (feed-order + cursor tests unchanged).
Alternatives Considered: Standardize the video fallback to `""` everywhere (defensible, but a behavior change out of scope for a refactor — flagged as a future decision); leave the duplication (ongoing drift).
Impact: One shared module; `/api/feed` also parallelized (one `Promise.all`). Standardizing the video fallback is an open follow-up.

## 2026-07-13 — date fix + local-first enrichment (10.1e)

### 2026-07-13
Decision: A provided post `date` means a HUMAN asserted it (`date_source='manual'`) — the client must not auto-send a file's EXIF date as the post date
Reason: The upload client was sending the first file's client-extracted EXIF date as `date`, which the server records as a high-trust manual override (no "est." badge), silently overriding the earliest-capture rollup with one arbitrary file's date. This is the most likely cause of the "Happy 250th America!" post displaying Jul 6 for a Jul 4 party. Manual override should mean deliberate human intent, not an automatic guess.
Alternatives Considered: Keep auto-sending but mark it a non-manual source (still wrong — it bypasses the earliest-capture rollup); rank the auto EXIF date below the rollup (adds a special case). Rejected in favor of the simplest rule: only a typed date is sent.
Impact: `earliestCapture()` shared by the server rollup and the compose-page "Suggested date" preview, so what the user sees is what gets saved; legacy `posts.date` falls back to the rollup instant when no date is typed.

### 2026-07-13
Decision: Editing a post's date must update the capture rollup (`taken_at`/`local_date`/`date_source`), not just legacy `posts.date`
Reason: Since Phase 10.2, reads prefer `local_date`/`taken_at` via COALESCE whenever they exist — which is every post created since 10.1. The edit route updated only `posts.date`, so date corrections through the UI were silently ignored on every read path. A correction the user can't see is worse than no feature.
Alternatives Considered: Make reads prefer `posts.date` (undoes the whole Phase 10.2 tz-correctness win); clear the rollup on edit so the legacy date wins (loses provenance). Rejected — the edit resolves the new value as a `manual` capture and writes the rollup, consistent with the "manual wins, record provenance" model.
Impact: `PUT /api/admin/posts/[postId]` writes the rollup; the edit form shows the effective (displayed) date + its provenance and only sends the date when the user changed it, so open-and-save can't stamp `manual`. Media added on the edit page also now runs the full upload-parity capture/identity/EXIF extraction (previously inserted with none).

### 2026-07-13
Decision: Deliver 10.1e enrichment as compose-time, browser-driven work — NOT the originally-planned async queue + Railway worker
Reason: The user is on the compose form for ~10s typing the title/tags anyway; running enrichment there (in parallel) delivers date/tag suggestions *before publish*, which is exactly when they're actionable — and it's the only way to influence the post date, which is set at publish. A background worker would land results too late for the date decision, and adds infra (queue, cron, a hosted worker, retry/status tracking) with no benefit at family-album scale. Vercel functions also have no GPU, so heavy local models belong in the browser regardless.
Alternatives Considered: Async enrichment queue + hosted worker (the old 10.1e plan — too late for dates, unjustified infra); server-side models on Vercel (no GPU, size limits). A small post-publish "sweeper" for stragglers is retained as `enrichment_status='pending'` rows, but the primary path is compose-time.
Impact: `useMediaEnrichment` hook + pure `src/lib/enrich/*`; no worker/cron added. The ROADMAP "10.1e = Railway worker" framing is superseded.

### 2026-07-13
Decision: Enrichment is local-first — in-browser OCR + phash always on and free; cloud vision (Claude) is an OPTIONAL layer, off without `ANTHROPIC_API_KEY`
Reason: Family photos including children — privacy and zero marginal cost matter more than maximum caption quality. OCR (tesseract.js, WASM) reads dates off flyers/invitations entirely on-device; phash tag propagation reuses hashes we already store; neither sends a pixel anywhere. Cloud vision adds real captions/labels and reads stylized text better, but at ~0.2–0.3¢/photo and by sending thumbnails off-device — so it's opt-in via env var, and the client hides it (503 → local-only) when unconfigured. Three sources fan out from one rendition and fail independently.
Alternatives Considered: Cloud-only (simpler, but costs per photo and sends every photo off-device, and can't identify family faces anyway); local-only (no captions, weaker on stylized text). The hybrid keeps the free/private path complete and makes cloud a pure upgrade.
Impact: `/api/admin/enrich` (cloud, gated), `/api/admin/similar-tags` (phash, local), `src/lib/enrich/ocr.ts` (OCR, local). New `media_metadata_raw` sources `'vision'` and `'ocr'`.

### 2026-07-13
Decision: Auto-tagging is closed-vocabulary and suggest-only — the model picks from EXISTING tags; machine output is never auto-applied to a post's visible tags
Reason: Visible tags are a small curated vocabulary that powers browse pages; letting a model invent tags produces near-duplicates ("bbq"/"barbecue"/"cookout") and vocabulary sprawl that's hard to walk back, and any wrong tag is visible and sticky in a keepsake album. Passing the album's existing tag list into the prompt (closed-vocabulary classification) both prevents duplicates at the source and is *more* accurate than free-form labeling. A fuzzy safety net collapses near-misses (barbeque→barbecue); at most two clearly-marked NEW proposals may be offered. Free-text labels go to search storage only, never the curated set.
Alternatives Considered: Auto-apply high-confidence tags (visible errors, vocabulary drift — revisitable later as a v2 for tags the user already uses, marked machine-applied with undo); open-vocabulary suggestions (duplicate sprawl). The `source` column on the junction tables (Phase 10.0) keeps any future auto-applied tags distinguishable and bulk-reversible.
Impact: `src/lib/enrich/tags.ts` (matching), tap-to-add chips in `MetadataFields`; untapped suggestions are never saved. Same pattern planned for People (match faces to the existing people list first).

### 2026-07-13
Decision: Date evidence from images requires literal, quoted text and a full day-level date; OCR-derived dates are only unambiguous written forms; nothing auto-applies
Reason: A photo can *show* a date (invitation, banner) that's better than the file metadata, but the failure modes are severe in a keepsake album — misreading decorative years ("1776" on patriotic art), ambiguous numeric dates (04/07/2026 is DMY or MDY — unknowable from pixels), or ambient guesses. So: require the model/OCR to quote the source text, require a full YYYY-MM-DD in a sane year range, and only suggest (tap-to-use fills the manual date field). OCR parses month-name and ISO forms only, and its evidence enters at medium confidence so cloud-verified document evidence outranks it.
Alternatives Considered: Auto-correct dates from image text (too risky — one bad read silently mis-dates a memory); accept numeric dates with a locale guess (wrong half the time). The suggestion is shown only when it can help (metadata date missing/estimated) or a confident document date conflicts with a trusted date by >1 day; equal-strength disagreement stays silent.
Impact: `src/lib/enrich/date-evidence.ts` (`validateDateEvidence`, `pickDateSuggestion`) shared by cloud, OCR, and the backfill's read-only conflict report; `extract-dates.ts` for OCR parsing.

### 2026-07-13
Decision: The local archive backfill mutates media enrichment (phash/OCR) but NEVER post dates — date disagreements are reported, not applied
Reason: Consistent with the standing "never overwrite the source of truth" rule. Filling missing phash and adding OCR payloads is additive and safe (enables tag propagation + search on old posts). Changing a post's displayed date is a judgment call that must stay human — an OCR read is medium-confidence and a decorative date could pass validation in rare cases. So the backfill prints a conflict report and the human fixes real ones via the (now-working) edit page.
Alternatives Considered: Auto-apply high-confidence conflicts (violates never-overwrite; OCR isn't trustworthy enough unattended); do nothing about conflicts (misses the whole point of the audit). Report-only splits the difference.
Impact: `scripts/backfill-local-enrich.ts` writes phash + `media_metadata_raw` (`source='ocr'`) only; the date-conflict report is read-only, resumable, and reuses `pickDateSuggestion` so it matches the compose-page UX exactly.

## 2026-07-21 — Faces → People (in-browser face clustering)

### 2026-07-21
Decision: Face detection + embeddings run IN THE BROWSER (@vladmandic/face-api, TensorFlow.js WebGL backend), never server-side and never via a cloud vision API
Reason: Same local-first logic as 10.1e enrichment, but the privacy argument is stronger — these are photos of children, and a face embedding is biometric-adjacent data. Vercel functions have no GPU and hard size limits, so a server-side model was never viable anyway. The WebGL backend specifically (not the WASM one) is required by the app's own CSP: `script-src 'self' 'unsafe-inline'` has no `'wasm-unsafe-eval'`, so instantiating the tfjs WASM backend would be blocked. WebGL uses no eval and needs no CSP exception. Weights load same-origin from `/models` (`connect-src 'self'`), so no CDN is involved either.
Alternatives Considered: Cloud vision face APIs (send every family photo, incl. children, to a third party — rejected outright); server-side models on Vercel (no GPU, size limits); tfjs WASM backend (would require loosening CSP with `'wasm-unsafe-eval'` — not worth it for a marginal speed difference); MediaPipe (modern detector but no built-in recognition descriptor, more glue).
Impact: `src/lib/faces/detect.ts` (lazy load, ~7 MB weights cached per session, fail-soft like `ocr.ts`), `public/models/` staged at build time. No change to `next.config.ts` CSP.

### 2026-07-21
Decision: Model weights are staged into `public/models/` at build time from node_modules, NOT committed to the repo
Reason: The weights (~6.7 MB) already ship inside the `@vladmandic/face-api` dependency; committing a second copy would bloat git history permanently and irreversibly. They can't be CDN-loaded (CSP), so they must be served from our origin — a `prebuild`/`predev` copy step satisfies both. The script fails loudly rather than silently, because a missing weight file at runtime looks like "no faces found" instead of a broken deploy.
Alternatives Considered: Commit the binaries (simplest, but 6.7 MB in history forever); fetch from a CDN at runtime (blocked by CSP, and adds a third-party dependency on a privacy-sensitive path).
Impact: `scripts/copy-face-models.mjs`, `prebuild`/`predev` hooks in package.json, `/public/models/` gitignored.

### 2026-07-21
Decision: Faces follow the tag pattern — closed-vocabulary, suggest-never-auto-apply. Naming a CLUSTER (not a face) is the single human decision
Reason: Consistent with the 2026-07-13 auto-tagging decision, and for the same reason: a wrong person on a family photo is visible, sticky, and worse than an extra prompt. Detected faces are stored unnamed (`person_id NULL`) and match against the EXISTING people list first; nothing reaches `post_people` until a human names the group. Naming once per cluster (rather than per face) is what makes it tractable across an archive. Face-derived person tags are written with `source='auto'` on the junction so they stay distinguishable from hand-curated ones and are bulk-reversible, and `INSERT OR IGNORE` never downgrades an existing `'human'` tag.
Alternatives Considered: Auto-apply high-confidence matches (visible, sticky errors in a keepsake album); per-face naming (unusable at archive scale); open-vocabulary face labels (meaningless — the whole point is matching the curated people list).
Impact: `src/lib/faces/cluster.ts` (`clusterFaces`, `matchToKnown`), `/api/admin/faces/name`, tap-to-add People chips in `MetadataFields`. Clustering/matching thresholds are deliberately TIGHT (0.5 / 0.52 vs face-api's usual 0.6) — biased toward an extra "who's this?" prompt over a wrong merge, since naming two clusters the same name merges them harmlessly but a wrong merge doesn't unmerge.

### 2026-07-21
Decision: The archive scanner owns ALL face persistence — the publish path (`upload/complete`, edit `PUT`) is left completely untouched
Reason: Compose-time face detection exists only to SUGGEST people while the form is open. Persisting faces there would mean threading face rows through the heavily-tested, load-bearing publish batch for no functional gain, since the scanner already picks up new uploads (`faces_scanned_at IS NULL`) uniformly. Keeping the publish path byte-identical to master means this feature carries zero regression risk for uploading — the thing that must never break.
Alternatives Considered: Persist compose-time faces at publish (saves the scanner re-detecting new uploads later, but touches the riskiest code path in the app for a minor optimization — revisitable once faces are proven).
Impact: `useMediaEnrichment` gains a 4th soft-failing source (face match) that writes nothing; `/api/admin/faces/scan` is the only face writer. Compose-time detection is GATED on `referenceCount > 0`, so the ~7 MB model never loads until at least one person has been named.

### 2026-07-21
Decision: Every write in the naming route derives from the still-unnamed subset of the submitted face ids, never from the raw ids
Reason: Surfaced by cold review. Two tabs (or one stale review page) naming the same cluster would otherwise tag posts with a person who ends up owning none of their faces — and could mint a brand-new person row with zero confirmed faces — because the `UPDATE` was guarded by `person_id IS NULL` but the affected-posts query and `post_people` inserts were not. Re-naming already-named faces is now a true no-op that creates nothing.
Alternatives Considered: A transaction/optimistic lock (heavier than needed at single-admin scale); accept the race (produces silent, hard-to-notice mis-tags in a keepsake album).
Impact: `/api/admin/faces/name` narrows to pending faces first and returns `namedFaces: 0` for a stale submit; the review page reloads instead of reporting success. Pinned by `tests/faces-routes.test.ts`.

## Open Questions

- Tumblr blog handle: exact identifier needed for API — **pending from Tom** (currently hardcoded as `www.thehoecks.com` in migration script)
- Phase 10 open decisions: backfill auto-apply confidence threshold (for the *cross-machine* 10.3b Matcher)? indexer stack (Python+osxphotos vs Node)? (Enrichment backend — **decided 2026-07-13: local-first**, on-device OCR/phash + optional cloud vision, see 2026-07-13 above. Original full-res archival in R2 — **decided 2026-07-09: yes**, see Phase 11c/10.3d above.) See `docs/rich-metadata-plan.md`.
