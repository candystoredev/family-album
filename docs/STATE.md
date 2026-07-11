# State

## Current Status
Live in production, auto-deployed from `master` via Vercel (project `thehoecks`,
canonical `thehoecks.com`). Tumblr migration completed 2026-03-07. Beyond the
original v1: an installable iOS PWA, daily "On this day" push notifications, a
Settings page, a gold "keepsake" design pass over the chrome, and unguessable
On-This-Day share links are all live. The project is its own repo
(`candystoredev/family-album`) with source at repo-root `src/...`.

**2026-07-09: full app review restructured the roadmap.** See ROADMAP.md. Next
up: **Phase 11 (Archive Safety)** — automated backups, `npm audit` fixes +
auth-middleware tests, bank full-res originals, GPS-strip served copies,
share-link revocation — then **Phase 12 (metadata correctness completion)**,
then **Phase 10.3 (historical backfill)**, still the centerpiece.

## ⏸ PAUSED — read this first when you come back (2026-06-26, reviewed 2026-07-09)

Taking a few weeks off mid–**Phase 10 (Rich Media Metadata & Enrichment)**. Full
design: [`docs/rich-metadata-plan.md`](rich-metadata-plan.md). Status table in
[`docs/ROADMAP.md`](ROADMAP.md). Everything below is committed, deployed, and
verified on prod — **you are stopped at a clean, safe checkpoint.**

**What Phase 10 is & why we're doing it.** Every photo/video used to collapse to
one timezone-less string `posts.date`, read three inconsistent ways (ordering
lexicographically, grouping as UTC, display as local). Result: the *same* photo
could land on a different day depending on which code path ran or the uploader's
timezone; photos and videos diverged; undated media fell back to upload time. The
goal: give every item **durable, precise, provenanced capture data** — a true UTC
instant (`taken_at`) for ordering and a timezone-independent capture day
(`local_date`) for grouping — plus identity hashes, GPS/device, and the full raw
metadata, so sorting/grouping are correct *and* future features (map, dedup,
semantic search, faces, "rediscover un-uploaded memories") stay open. Guiding
bias: **capture more than we model, never overwrite, record provenance, keep it
re-runnable.**

**What's DONE (shipped + verified on prod):**
- **10.0** additive schema · **10.1a–d** capture at upload (dates, HEIC fix,
  identity/visual hashes, GPS/device/raw) · **10.2a–c** flipped reads to the
  effective capture date (feed order/cursor, grouping, display + "est." badge).
- The correctness core is complete and the feed is live and confirmed working.
  No production data was mutated — reads use a read-time `COALESCE` fallback, so
  historical posts (which have no new columns yet) keep their exact prior order.

**WHERE TO RESUME — updated 2026-07-09 per restructured ROADMAP.md: Phase 11 →
Phase 12 → Phase 10.3.**
1. **Phase 11 (Archive Safety) then Phase 12 (metadata correctness completion)
   come first — both small.** Then **10.3 Historical backfill** — still *the big
   payoff*. Phash-match the album's re-encoded thumbnails to your local original
   files (Apple Photos via `osxphotos`, Dropbox, folders) on a Claude-less
   machine, then apply real capture dates / GPS / faces to the thousands of
   historical posts that are currently `NULL`. Separate two-tool design (Indexer
   + Matcher/Applier) already spec'd in the plan doc; now expanded to sub-phases
   10.3a–e (adds review-queue merge, originals archival, post-backfill promote
   step) — see ROADMAP.md. This is what makes 10.1/10.2 pay off for old content.
2. **10.1e Async enrichment queue + Railway worker** — deferred on purpose: its
   ML backends (faces/scene/caption/embedding) are stubs until **10.5**, so build
   the two together or not yet.
3. **Pause / polish** — small tracked gaps below.

**Mental model for resuming:** the upload path writes the new columns
(`src/lib/media/capture-date.ts`, `extract.ts`, `image-hash.ts` →
`src/app/api/admin/upload/complete/route.ts`); reads consume them via
`src/lib/order.ts` (`ORDER_KEY_SQL`/`EFF_DAY_SQL`). Inspect what got written on
prod with `scripts/capture-check.ts` (needs prod `TURSO_*` env). All additive /
write-only; the legacy `posts.date` is still the immutable source of truth until
a future audited "promote" step.

## Active Branch
`master` (work is done on short-lived branches, fast-forward merged, then pushed —
each push auto-deploys to production).

## Current Task
**Roadmap restructured 2026-07-09** (see ROADMAP.md) — next session starts
**Phase 11a (automated backups)**.

Prior task, still true: **Phase 10 — Rich Media Metadata & Enrichment** (see
`docs/rich-metadata-plan.md`). 10.0, 10.1 (a–d), and 10.2 (a–c) all shipped &
verified on prod.
- **10.0 (schema) — DONE**, deployed + `/api/init` run on prod 2026-06-25.
- **10.1 (capture at upload) — DONE** (write-only): 10.1a dates, 10.1d HEIC fix,
  10.1b identity/visual, 10.1c GPS/device/raw + `media_sources`. Every upload
  banks the full rich-metadata set. **10.1e (async enrichment queue + Railway
  worker) is the one remaining sub-stage — deferred** (its ML backends are stubs
  until 10.5, so the queue would have no real work yet).
- **10.2 (flip reads) — DONE**: 10.2a feed ordering + cursor by effective
  `taken_at`, 10.2b archive/on-this-day grouping by effective `local_date`,
  10.2c display the corrected date + "est." badge. Read-time `COALESCE` (see
  `lib/order.ts`) — no prod data mutated; existing posts keep their exact order.
- **Next options:** 10.1e (enrichment infra, gated on 10.5), 10.3 (historical
  backfill — separate track, runs on a Claude-less machine), or pause.

## Blockers
None.

## Known Issues
- A couple of historical mentions of `apps/thehoecks/` remain in older docs'
  completed/decision entries (ROADMAP/DECISIONS) — kept for history, not
  current paths. STATE.md itself is now fully corrected to `src/...`.
- New columns are populated only for posts uploaded since 10.1 (a handful);
  historical/migrated content is `NULL` until the 10.3 backfill. Reads handle
  this via `COALESCE` fallback, so the feed is correct either way.
- **FTS `body` not searchable for posts created since the last rebuild** —
  incremental indexing on new posts never wired up. → Phase 12c.
- **Archive page vs archive API grouping disagreement** — archive page still
  groups by legacy `posts.date`, archive API uses effective `EFF_DAY`; they can
  disagree for posts with corrected capture dates. → Phase 12a.

## Recent Changes

### 2026-07-09 session — full app review + roadmap restructure
Full four-way review of the whole app (tech debt, security re-verification,
performance, docs-vs-code drift) — no code changes beyond docs; all 69 tests
pass.
- **Roadmap restructured:** Phases 5–8 retired/absorbed; new **Phases 11–14**
  added; **Phase 10.3 expanded to 10.3a–e** (adds review-queue merge, originals
  archival, post-backfill promote step). Full rationale in ROADMAP.md +
  DECISIONS.md 2026-07-09 entries.
- **Security re-verification:** `sw.js` off-origin navigation is **FIXED** (URL
  re-based to origin — the old Phase 3 item is stale); `/posts/[slug]` in-page
  session gating confirmed working as designed; remaining open items re-homed to
  Phases 11d/11e/13. `npm audit` currently: **3 high** (Next.js
  middleware-bypass class CVEs + `ws`) → Phase 11b.
- **Key review findings driving the new plan:**
  - Full-res originals are discarded at upload (client compresses to 1920px
    before R2) → bank originals (Phase 11c / 10.3d).
  - FTS `body` never indexed incrementally — search gap → Phase 12c.
  - Archive page still groups by legacy date while archive API uses `EFF_DAY`
    (they can disagree) → Phase 12a.
  - ~6 date-display sites bypass `formatDisplayDate` → Phase 12b.
  - Edit page's private `compressImage` lacks HEIC support (real bug) → Phase 13.
  - `invite_links` confirmed dead → delete in Phase 13.
  - Feed images intentionally stay full-size (pinch-zoom detail valued; R2
    egress is free) — srcset only if needed later → Phase 14.
- **Also merged this week** (unrelated to the review, see 2026-07-06 entry for
  detail): PR #31 (2026-07-09), PR #32 (2026-07-09), PR #33 (2026-07-09); PR #28
  merged 2026-07-07.

### 2026-07-06 session — notifications hardening + Security Phase 1 (parallel track, not Phase 10)
A batch of fixes on top of the daily-notifications feature, then a full security
audit + first hardening pass. All merged to `master` and live, including the
crop PR (merged 2026-07-07 — see below).
- **Notifications fixes:** manual "Send today's memory now" 401 fixed (daily
  endpoint now also accepts an admin session, not just the cron bearer);
  emojis removed from notification titles; **scheduling made reliable** — the
  daily endpoint now sends on the first run *at/after* the configured hour
  (`now.hour >= sendHour` + once-per-day guard) instead of an exact-hour match,
  so a skipped GitHub-cron run self-heals; workflow bumped to every 30 min.
  iOS **notification deep-link fixed** — SW `postMessage`s the open PWA and an
  in-page listener (`ServiceWorkerRegister`) routes to `/today` via the router,
  since iOS ignores `WindowClient.navigate()`.
- **iPad menu fix** — `ArchiveMenu` now treats hover-incapable (touch) devices
  as mobile (`matchMedia('(hover: hover)')`), so iPads ≥1024px get the tappable
  FAB instead of the hover-only tucked sidebar. Mobile FAB `lg:hidden` →
  `[@media(hover:hover)]:lg:hidden`.
- **Share links** now derive their domain from the request host
  (`lib/baseUrl.ts` / `window.location.origin`), not `NEXT_PUBLIC_SITE_URL`.
- **Upload discard** button de-floated (was `fixed` and covered the form under
  the iOS keyboard) — now inline at the bottom.
- **Security Phase 1 (PR #29, merged + verified on prod):**
  - `/posts/[slug]` **gated behind a session** — the page stays reachable so
    link-preview crawlers read the OG tags, but photos/caption render only when
    logged in (previously the whole album was readable by slug-guessing). og:image
    now uses the thumbnail, not the full-res original.
  - **Login rate limiting** — Turso-backed `login_attempts` table, 10/10min per
    IP → 429 (`lib/rateLimit.ts`). No new infra.
  - Removed the hardcoded `"hoecks2025"` default viewer password (fail closed).
  - **Secrets fail closed** — `lib/safeCompare.ts` `safeEqual` (Web Crypto,
    constant-time, length-independent) for admin password + all bearer/cron
    tokens; `getSecret()` throws if `JWT_SECRET` missing/<32 chars; JWT alg pinned
    to HS256. Fixes the `Bearer undefined` fail-open + admin-password length oracle.
  - **Security headers** added in `next.config.ts`: CSP (allows `*.r2.dev` +
    `*.r2.cloudflarestorage.com`), HSTS, `X-Frame-Options: DENY`, nosniff,
    Referrer-Policy, Permissions-Policy.
  - `/api/seed` now returns 403 in production (its `DELETE ?clean=all` deletes by
    matching seed titles → could hit real posts).
- **Verified on prod:** all headers live/correct; logged-out `/` → 307 `/login`.
  *Not* automatable here: in-browser CSP-violation check on authenticated pages
  (needs login + the sandbox proxy blocks headless Chromium) — recommend a manual
  console glance on home/post/**upload** (the R2 PUT under CSP).

**DEFERRED / OPEN from this session — updated 2026-07-09:**
- **PR #28 — Add photo cropping to the edit page: MERGED 2026-07-07.** Server-side
  `sharp` crop-on-Save. ✓ **GPS conflict resolved correctly** — as merged, the
  crop path re-encodes and strips *all* EXIF (sharp's default without
  `withMetadata`, documented in the route; the PR's original preserve-EXIF
  approach was dropped), so cropped images carry no GPS.
- **Also merged since (2026-07-09):** PR #31 "Show edits after save; add PWA
  refresh + back controls"; PR #32 "Move Refresh from the nav sidebar to the FAB
  cluster"; PR #33 "Fix stale feed after editing a post: navigate forward, not
  back."
- **`/posts/[slug]` in-page session gating** (Security Phase 1) — re-verified
  2026-07-09, confirmed working as designed. No further action.
- **Security Phase 2 (privacy & integrity)** — items now live in ROADMAP Phases
  11d + 13. Kept here for history: strip GPS/EXIF from publicly-served
  originals *and videos* (upload `complete` "already-processed" fast path serves
  raw bytes with EXIF intact — `complete/route.ts`, `lib/media/compress.ts`);
  lengthen R2 key entropy (`nanoid(4)`→21 in `presign`); validate client-supplied
  `r2Key`/`keyPrefix` in `upload/complete` + posts `PUT` (arbitrary bucket
  read/write); sanitize post `body` (DOMPurify) at the 4 `dangerouslySetInnerHTML`
  sites.
- **Security Phase 3 (hygiene)** — items now live in ROADMAP Phases 11b (`npm
  audit`), 11d (size cap), 11e (share-link revocation) + 13. Kept here for
  history: session revocation (`tokenVersion` epoch,
  shorter expiry) — 90-day JWTs currently unrevocable; share-link revocation +
  expiry (`post_share_links` no revoke, `day_share_links` never expire);
  push-subscribe SSRF allow-list (`endpoint` is an unvalidated URL the cron POSTs
  to); `npm audit fix` (Next/`ws`/`postcss`); remove/implement dead `invite_links`
  table; upload size cap; CSP nonce (drop `'unsafe-inline'` scripts); ~~constrain
  `sw.js` nav to same-origin~~ — ✓ already fixed (URL re-based to origin;
  verified 2026-07-09, the old Phase 3 item is stale); stop echoing
  `String(error)` to clients.

### 2026-06-25 session — Phase 10.0 + 10.1(a–d) + 10.2(a–c)
- **10.0** additive rich-metadata schema (media + posts columns,
  `media_metadata_raw`, `media_sources`, `source` on junctions, indexes;
  `ensureRichMetadataSchema()` lazy-ensure). Deployed + applied to prod.
- **10.1a/d/b/c** capture pipeline (see ARCHITECTURE "Rich media capture
  pipeline"). New: `lib/media/capture-date.ts`, `extract.ts`, `image-hash.ts`;
  `heic2any` dep; `scripts/capture-check.ts`. Each stage deployed and verified
  against real uploads on prod (dates incl. HEIC EXIF, identity hashes, GPS +
  device + raw payload + `media_sources`). All write-only.
- **10.2a/b/c** flipped reads to the effective capture date via read-time
  `COALESCE` (`lib/order.ts`): feed ordering/cursor, archive + on-this-day
  grouping, and corrected-date display + estimated badge. No prod data mutated;
  existing order proven byte-identical (`tests/feed-order.test.ts`). Verified
  live: feed scroll/pagination, archive, on-this-day all good.
- tests added: capture-date, exif-pipeline, heic, image-hash, extract,
  feed-order, display-date.

### 2026-06 session — wrap
- Planning docs (STATE/DECISIONS/ARCHITECTURE/ROADMAP) brought current + new
  `docs/rich-metadata-plan.md`; committed & pushed (`6d11d3b`). Roadmap now has
  Phase 10. No code in progress; clean stopping point. Next: Phase 10.0 + 10.1.

### 2026-06 session (design + On This Day + video dates)
- **Video capture dates** (`lib/media/exif.ts`): parse MP4/MOV `moov/mvhd` and
  prefer Apple `com.apple.quicktime.creationdate` (local time + UTC offset) so
  videos date from capture, keep full time-of-day for same-day ordering, and
  need no GPS→tz lookup. Filename fallback. Tests in `tests/video-date.test.ts`.
- **On This Day share links** — unguessable token route `/m/[token]` (public, OG
  preview, gold styling) backed by a lazily-created `day_share_links` table +
  `POST /api/share/day` (any logged-in user mints/reuses a token). "Share this
  day" button on `/today`. `/m` added to middleware public paths.
- **`/today` page** restyled gold; up to 6 memories (≤2/year); homepage teaser +
  push notification stay at 3. `getMemoriesForDate(month,day,year,limit,maxPerYear)`
  is shared by all three surfaces; only previous years (`< year`) are included.
- **Navigation redesign (ArchiveMenu)** — gold serif monogram header, compact
  rows (The Latest / Favorites / On This Day), compact Albums with an "All
  albums" expand-in-place that fades/collapses the timeline, year timeline with
  classic + **rail** layouts, FAB cluster (Upload / Albums-toggle / Settings)
  that packs with no gap. Timeline layout is a shared preference (`useTimelineStyle`,
  `localStorage` key `hoecks_timeline` + custom event), set from Settings.
- **Gold "keepsake" design pass** — `Source Serif 4` added as the display voice;
  gold accent `#c2a467` in the chrome (nav/settings/upload); paper-grain overlay;
  canvas `#1a1918`. Feed/lightbox/post/login intentionally keep the blue `#427ea3`.
- Earlier in session (pulled in at start): daily "On this day" **push
  notifications** (web-push/VAPID, `push_subscriptions`, `/api/notifications/*`,
  daily cron) + **Settings page** + **iOS standalone PWA** (manifest, service
  worker, gold monogram icon, auto-refresh on re-foreground).

### Pre-session (historical)
- Memory card (OnThisDay): hold caption 500ms → navigates to full post page; lightbox now disables outer swipe while open; swipe threshold raised 60→90px
- Feed: long-press action sheet now for all users — non-admin sees Share (iMessage to Tom/Victoria), admin sees Edit + Share (native share panel / clipboard fallback); tap-to-bubble removed
- 5c UX polish: long-press caption (500ms hold) opens edit sheet; fixed iOS pointercancel killing the timer; router.back() after save restores feed scroll position
- 5c bug fixes: SSR image hydration (img.complete on mount), video poster fallback (omit poster attr when no thumbnail), autoPlay on video preview for iOS canvas capture
- Phase 5c: Edit + delete posts — `GET/PUT/DELETE /api/admin/posts/[postId]`, `/admin/posts/[postId]/edit` page, hold-to-edit sheet in feed (admin-only)
- Phase 5b: Replaced custom drag-and-drop with @dnd-kit/core + @dnd-kit/sortable + @dnd-kit/utilities
  - PointerSensor (distance:8) handles mouse and touch — no long-press required
  - SortableMediaItem with useSortable: transform/transition/opacity from hook, cursor-grabbing while active
  - DragOverlay renders floating ghost of dragged item
  - arrayMove for clean reorder on dragEnd
  - Remove button uses onPointerDown stopPropagation to prevent arming sensor
- Phase 5b: Full upload form — multi-file, title, date, tags, people, albums, drag-reorder, video poster capture
- Phase 5b: Presign endpoint now accepts video types (mp4, quicktime, webm)
- Phase 5b: Complete endpoint handles multiple media items, auto-detects post type (photo/video/mixed)
- Phase 5b: Tags and people find-or-create on upload, albums assigned by ID
- Phase 5b: Photoset layout auto-generated for multi-photo posts
- Phase 5b: Video poster frame captured via canvas on client, uploaded as thumbnail
- Phase 5b: Admin autocomplete APIs for tags (`/api/admin/tags`), people (`/api/admin/people`), albums (`/api/admin/albums`)
- Phase 5b: FTS5 index updated with tags and people names on upload
- Phase 5a: Single photo upload — `/admin/upload` page + `POST /api/admin/upload` endpoint
- Phase 5a: EXIF date/time extraction, sharp thumbnail generation (400px), auto-rotate
- Phase 5a: R2 keys use timestamp format: `media/YYYYMMDD-HHmmUTC-{id}/original.jpg`
- Phase 5a: "Upload Photo" link added to admin section of sidebar
- Phase 4 complete — all sub-phases 4a through 4i done
- Phase 4i: "On This Day" — full feature with thumbnail row, swipeable memory cards, nav arrows, dot indicators, lightbox
- Phase 4i: Double-tap hearts, image fade-in, skeleton shimmer, randomized end-of-feed messages, scroll-to-top, feed prefetch
- Phase 4i: iMessage bubble redesigned, post spacing tightened, lightbox swipe improved
- Phase 4i: Known polish deferred: nav button overlap on some viewports, single-image memory card sizing on narrow screens
- Phase 4h: Feed images now serve originals instead of 400px thumbnails
- Phase 4h: Desktop sidebar — persistent left nav at 35% opacity, full on hover (lg+ breakpoint)
- Phase 4h: Mobile keeps FAB + slide-out panel unchanged
- Phase 4h: Removed sticky headers from all 8 pages
- Phase 4h: Added BannerMessage component (reads `banner_message` from site_settings)
- Phase 4h: Logout + admin badge moved to sidebar bottom
- 2026-03-07: Full Tumblr migration completed against production, FTS index rebuilt
- Phase 4f: FTS5 search — search bar in slide-out panel, `/search?q=` results page
- Phase 4f: Search API at `/api/search` with FTS5 ranking, offset pagination
- Phase 4f: FTS5 fixed — standalone table indexing title, body, tags, and people names
- Phase 4e: Floating archive menu button (FAB) with slide-out panel
- Phase 4e: Panel includes "The Latest", "Featured" (albums), and year/month timeline
- Phase 4e: FAB hides on scroll-down, shows on scroll-up with jitter threshold
- Phase 4e: Archive index page at `/archive` — year/month grid with post counts
- Phase 4e: Month pages at `/archive/{year}/{month}` — oldest-first feed with infinite scroll
- Phase 4e: Previous/next month navigation on month pages
- Phase 4e: Feed API extended with `year`+`month` params, oldest-first ordering
- Seed data cleaned from dev site (`DELETE /api/seed?clean=all`) — only real migrated content remains
- Clean-all seed endpoint added to remove seed posts, media, tags, people, and albums
- Schema init hardened: tumblr_id index created after migration to avoid conflicts
- Migration script hardened: transactions, slug dedup, seed cleanup
- Tumblr OAuth key renamed to match Vercel env convention
- Tumblr blog ID and family people list configured for migration
- Phase 4d: Tag/people/album filtered pages with cursor-based infinite scroll
- Phase 4d: Feed API extended with filter params, returns tags/people per post
- Phase 4d: Clickable `@person` and `#tag` links in feed
- Phase 4d: Shared `lib/feed.ts` for server-side feed fetching
- Fullscreen lightbox with swipe, keyboard arrows, dot indicators
- iMessage chat bubble on feed posts
- Post detail page simplified to permalink-only (OG tags for link previews)

## Relevant Files
- `src/app/admin/posts/[postId]/edit/page.tsx` — edit page: pre-populated form, manage existing+new media, drag-reorder, delete post
- `src/app/api/admin/posts/[postId]/route.ts` — GET (post data for edit form), PUT (save edits), DELETE (post + R2 cleanup)
- `src/app/admin/upload/page.tsx` — multi-file upload page with drag-reorder, tag/people/album pickers, video poster capture
- `src/app/api/admin/upload/presign/route.ts` — presigned URL generation (photos + videos)
- `src/app/api/admin/upload/complete/route.ts` — multi-file processing, tag/people/album assignment, FTS update
- `src/app/api/admin/tags/route.ts` — tag autocomplete API
- `src/app/api/admin/people/route.ts` — people autocomplete API
- `src/app/api/admin/albums/route.ts` — album autocomplete API
- `src/app/page.tsx` — home feed (SSR first page)
- `src/components/Feed.tsx` — infinite scroll client component with tag/people links
- `src/app/api/feed/route.ts` — cursor-based feed API with filter support
- `src/lib/feed.ts` — shared server-side feed fetching logic
- `src/app/tags/[slug]/page.tsx` — tag filtered page
- `src/app/people/[slug]/page.tsx` — person filtered page
- `src/app/albums/[slug]/page.tsx` — album filtered page
- `src/app/archive/page.tsx` — archive index (year/month grid)
- `src/app/archive/[year]/[month]/page.tsx` — month page (oldest-first)
- `src/app/api/archive/route.ts` — archive API (years/months/counts + albums)
- `src/components/ArchiveMenu.tsx` — floating menu button + slide-out panel + search
- `src/app/api/search/route.ts` — FTS5 search API
- `src/app/search/page.tsx` — search results page (server wrapper)
- `src/app/search/SearchResults.tsx` — search results client component
- `tests/cursor-pagination.test.ts` — cursor pagination tests
- `src/app/login/page.tsx` — login page
- `src/middleware.ts` — auth middleware
- `src/lib/auth.ts` — session/JWT/password logic
- `src/lib/db.ts` — Turso client
- `src/lib/r2.ts` — R2 upload/delete
- `src/lib/schema.ts` — all table definitions + FTS5
- `src/app/posts/[slug]/page.tsx` — individual post page with OG tags
- `src/components/PhotoGrid.tsx` — multi-photo grid + layout parser
- `src/components/Lightbox.tsx` — fullscreen image viewer with swipe
- `src/components/LogoutButton.tsx` — logout UI
- `src/components/SeedButton.tsx` — seed test data UI
- `src/app/api/init/route.ts` — schema init + settings seed
- `src/app/api/seed/route.ts` — test data seeder (25 posts)
- `src/app/api/auth/login/route.ts` — login endpoint
- `src/app/api/auth/logout/route.ts` — logout endpoint
- `src/app/robots.txt/route.ts` — crawler blocking
- `scripts/migrate.ts` — Tumblr migration script

## AI Guardrails
Assumptions:
- Phases 1-4 are considered complete per ROADMAP.md phase definitions
- Production migration completed 2026-03-07, site live with all content
- **thehoecks.com** is the production site (was dev.thehoecks.com earlier)
- Tom is the primary admin user

Constraints:
- All changes must work within Vercel free tier limits
- Media uploads must go through presigned R2 URLs (not through Vercel)
- All passwords must be bcrypt hashed, never plaintext
- Post pages serve **OG metadata publicly** but **gate content behind a session**
  (changed in Security Phase 1 — no longer fully public)
- `JWT_SECRET` must be ≥32 chars or auth throws (fail-closed); login is
  rate-limited; no hardcoded default passwords; `/api/seed` is prod-blocked
- Do not break existing auth flow
- Never serve `originals/` prefix objects publicly (Phase 11c bank-originals)
- Share links are persistent by design — revocation yes, auto-expiry no

Do Not:
- Add new services or paid dependencies without explicit approval
- Change the database schema without updating `schema.ts` and ARCHITECTURE.md
- Modify auth middleware behavior without re-verifying all access paths
- Run the migration script against production without Tom's confirmation
- Remove crawler blocking from post pages
- Store plaintext passwords anywhere
- Add features from the V2 backlog during current phases
