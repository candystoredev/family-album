# Architecture

## System Overview

Private family photo album replacing a Tumblr blog at thehoecks.com (~15 years, hundreds of posts, ~260 videos). Auth-protected web app with direct iPhone upload support and iMessage-based feedback instead of comments.

### Source Site (thehoecks.com on Tumblr)
- Tumblr-hosted since ~2012, custom dark theme (bg `#1d1c1c`, text `#d3d3d3`, accent `#427ea3`)
- Typography: "Calluna Sans" font, centered text, 1.5rem body
- Layout: single-column feed, ~900px desktop, centered, infinite scroll
- Content: title + photo(s)/video + caption + date + tags (60+ tags: people, time, location, content type)
- Mix of photos, photosets (multi-photo), and videos

### Design Principles (carried from Tumblr)
- Simple chronological browsing
- Rich tagging (people, locations, themes)
- Dark theme making photos pop
- Captions/titles for context
- Visual-first, low friction

### Improvements Over Tumblr
- Self-hosted (no platform dependency)
- Privacy controls (auth, share links)
- Direct iPhone upload via iOS Shortcut
- Album/gallery grouping beyond tags
- FTS5 search
- No social sharing clutter or reblog model

## Components

### Frontend
- **Next.js** (App Router) on **Vercel** free tier
- **Tailwind CSS** — dark theme (bg `#1d1c1c`, text `#d3d3d3`, accent `#427ea3`)
- Single-column feed, ~900px max width, centered
- Photo interaction: full-screen lightbox on click, swipe/arrow navigation
- Multi-photo posts: grid/mosaic layout using `photoset_layout` string or auto-calculated

### Media Storage (Cloudflare R2)
- Bucket: `thehoecks-media`, public access enabled
- Zero egress fees
- Presigned upload URLs for admin panel and iOS Shortcut (bypasses Vercel 4.5MB body limit)

#### R2 Key Convention
```
media/{media_id}/original.{ext}      — full-size original (served)
media/{media_id}/thumb.{ext}         — optimized thumbnail for feed
originals/{media_id}/original.{ext}  — planned (Phase 11c): untouched full-res original, private, never served
```
Extensible: future variants added as sibling files without schema changes.

Backups (`backups/thehoecks-YYYY-MM-DD.sql.gz`) do **not** live under this bucket —
they're in a separate private bucket, `thehoecks-backups`. See "Backup Strategy" below.

### Database (Turso / SQLite)
- **Turso** free Starter plan with FTS5 full-text search
- FTS5 standalone table (`posts_fts`) — not external content mode, synced at application level
- Indexed fields: `post_id` (unindexed key), `title`, `body`, `tags` (space-separated names), `people` (space-separated names)
- `rebuildFtsIndex()` rebuilds from `posts` + `post_tags`/`tags` + `post_people`/`people` joins
- Incremental sync exists on create/edit/delete: upload complete inserts a row; editing a post (`PUT`) deletes + reinserts; deleting a post removes the row. **Caveat (until Phase 12c)**: incremental writes index `body` as an empty string — only a full `rebuildFtsIndex()` backfills real body text.
- Full rebuild still triggered by `POST /api/init` (used for backfill/repair, not just first-run init)

### Authentication & Access Control
- **Viewer access**: Shared password. Admin-changeable from settings page. Stored as bcrypt hash in `site_settings`.
- **Public read-only access**: Unguessable share links — `/share/[token]` per-post (30-day expiry) and `/m/[token]` per-day (persistent). No login required.
  (Invite links were planned but never built; cut 2026-07-09 — see DECISIONS.)
- **Admin access**: Separate admin password (env var). Gates admin panel + settings.
- **API/iOS**: Bearer token (`ADMIN_API_TOKEN`) for iOS Shortcut uploads
- All browsing routes protected by default
- Individual post pages publicly accessible by URL (for iMessage OG previews) but not discoverable

## Data Flow

### Feed Rendering
```
Client request → Middleware (JWT check) → Next.js API → Turso query → R2 media URLs → Browser
```

### Upload Flow (Admin Panel / iOS Shortcut)
1. Client calls `POST /api/admin/upload/presign` → presigned R2 PUT URL(s)
2. Client uploads (PUTs) the file(s) directly to R2
3. Client calls `POST /api/admin/upload/complete` with metadata + R2 keys — server re-encodes/generates thumbnails via `sharp`, writes the post + media records, and syncs FTS

(There is no `POST /api/posts` — that route never existed. The real flow is presign → direct R2 PUT → `/api/admin/upload/complete`.)

Step 3 constraints: R2 → Vercel fetch is fast (Cloudflare network), `sharp` resizes typical iPhone photo (3-8MB) in <1 second, thumbnail upload (~100KB) near-instant. Within Vercel 10-second function timeout. For unusually large files, the API can stream the download rather than buffering the full file.

### Video Handling
- **Migration**: `ffmpeg` locally extracts poster frame
- **Admin uploads**: client-side `<video>` + canvas API captures frame (avoids server ffmpeg)
- Direct R2 serve, no transcoding

### Tumblr Migration

**API**: Tumblr v2 API (`/v2/blog/{blog-identifier}/posts`). OAuth credentials required: Consumer Key + Consumer Secret. Paginate with rate-limit backoff.

**Migration Config** (required before running):
- People list: array of names to route to `people` table (e.g., `["Sophie", "Emma", "Grandma"]`)
- Tumblr blog identifier (e.g., `thehoecks.tumblr.com`)
- R2 credentials (account ID, access key, secret key, bucket name)
- Turso connection info (database URL, auth token)

**Staged Testing** (run against real Tumblr API):
1. 10 posts: Verify data flow — check DB records, R2 media, thumbnails, tags, people mapping
2. 100 posts: Spot-check variety — multi-photo grids, video playback, date parsing, slug dedup
3. Full migration: Compare summary against expected totals, browse feed to sanity check

**Post-migration verification**: Post count matches Tumblr. Media count matches (originals + thumbnails). No orphaned media or orphaned records. People and tags correctly split.

**Data Flow**:
1. Paginate all posts via Tumblr API v2
2. Extract: title, body/caption, timestamp, media URLs, tags, post type, `photoset_layout`
3. Sanitize HTML in captions/bodies (strip unsafe tags, preserve basic formatting)
4. Download all media, record `file_size` in bytes
5. Upload originals to R2 as `media/{media_id}/original.{ext}`
6. Generate photo thumbnails via `sharp`, video poster frames via `ffmpeg`; upload as `media/{media_id}/thumb.{ext}`
7. Map Tumblr post types: photo/video → `photo`/`video`/`mixed`; text/quote/link/answer → `text`
8. Month/year tags (aug2013, oct2024) → parsed into post `date` field
9. Tags matching people list → `people` table + `post_people` junction
10. All other tags → `tags` table + `post_tags` junction (with auto-generated slugs)
11. Auto-generate slug from title; untitled posts get date-based slug. Duplicates suffixed (`-2`, `-3`)
12. Write records to Turso (FTS5 sync via triggers)
13. Output summary: post count by type, media count, people/tags imported, skipped items with reasons
14. Immediately after: `turso db dump` for baseline backup

## Integrations

### iMessage Feedback System
- **Button**: "Text us about this" (green, iMessage system color, large and obvious)
  - Sub-text: "Opens a text message on your phone"
  - Placement: Below photo(s) on individual post page
- **Recipients**: Group message via `sms:+1XXXXXXXXXX,+1YYYYYYYYYY&body=...`
- **Numbers**: Stored in `site_settings` (`imessage_recipients`), admin-changeable
- **Pre-filled message**:
  ```
  https://thehoecks.com/posts/[post-slug]

  My reaction:
  [cursor here]
  ```
- **Desktop fallback**: "To share your thoughts, text us at [number(s)] and mention the photo title"
- **OG tags**:
  ```html
  <meta property="og:title" content="[post title]" />
  <meta property="og:description" content="Posted [date]" />
  <meta property="og:image" content="[first media URL]" />
  <meta property="og:url" content="[post URL]" />
  <meta property="og:site_name" content="The Hoecks" />
  ```

### iOS Shortcut
1. Select photos/videos → Share → "Post to Family Album"
2. Mini form: title (optional), tags, people
3. `POST /api/admin/upload/presign` (Bearer token auth) → presigned R2 PUT URL per file
4. Upload each file directly to R2
5. `POST /api/admin/upload/complete` with metadata + R2 keys
6. Server re-encodes/generates thumbnails via `sharp`; continues in background if user switches apps
7. EXIF date extracted → pre-fills post date

**Share-to-upload** (shipped): sharing photos/videos into the Shortcut from another app presigns and PUTs directly to R2, then opens `/admin/upload?ingest=…` in the browser — backed by `POST /api/admin/upload/ingest-fetch`, which pulls the R2 object(s) into the normal upload-review flow.

### Privacy & Crawler Blocking (3 layers)
1. `robots.txt`: Blocks well-behaved crawlers from entire site
2. `<meta name="robots" content="noindex, nofollow">`: On individual post pages
3. `X-Robots-Tag: noindex` response header

iMessage/social crawlers intentionally ignore `robots.txt` (desired — enables link previews). Search engines respect `robots.txt` and `noindex`.

## Data Model

```sql
posts
├── id (PK, nanoid)
├── slug (unique, URL-friendly, auto-generated from title, editable)
├── title (optional)
├── body (optional, sanitized HTML)
├── date (from EXIF, Tumblr metadata, or manual override)
├── type (photo | video | mixed | text)
├── photoset_layout (e.g., "212" = 2-1-2 grid rows)
├── tumblr_id (original Tumblr post ID, used for migration dedup)
├── created_at
├── updated_at
│   -- Phase 10.0 rollup (representative = earliest media; additive/nullable)
├── taken_at (UTC ISO), local_date (YYYY-MM-DD), date_source, source (upload|bulk|tumblr|shared)

media
├── id (PK, nanoid)
├── post_id (FK → posts)
├── r2_key (path to original in R2)
├── thumbnail_r2_key (path to thumbnail in R2)
├── type (photo | video)
├── width, height (integer)
├── file_size (bytes)
├── duration (seconds, video only)
├── display_order (integer)
├── mime_type
│   -- Phase 10.0 rich metadata (all additive/nullable; lazy ensureRichMetadataSchema)
├── taken_at (UTC ISO instant), tz_offset (min), local_date (YYYY-MM-DD),
│             date_source, date_confidence (high|medium|low)   -- order by instant, group by local day
├── gps_lat, gps_lng, gps_altitude, place (cached reverse-geocode)
├── camera_make, camera_model, lens, iso, aperture, shutter_speed, focal_length
├── fps, codec, is_live, is_screenshot, dominant_color, aspect, orientation
├── content_hash (SHA-256 of original), phash (perceptual), original_filename
├── caption, embedding (BLOB; vector index in 10.5), quality_score
├── enrichment_status (none|pending|done|error), enrichment_version, enriched_at
├── source (upload|bulk|tumblr|shared)

tags
├── id (PK, nanoid)
├── name (unique)
├── slug (unique)
├── created_at

post_tags (junction: post_id, tag_id)

people
├── id (PK, nanoid)
├── name
├── slug (unique)
├── created_at

post_people (junction: post_id, person_id)

albums
├── id (PK, nanoid)
├── title
├── slug (unique)
├── description (optional)
├── cover_media_id (FK → media, nullable, defaults to most recent)
├── created_at

post_albums (junction: post_id, album_id)

-- invite_links: REMOVED 2026-07-11 (Phase 13b, #48) — was never implemented
--   (no route ever read/wrote it); shared password + share links cover viewer access.

site_settings (key-value)
├── key (PK: viewer_password_hash, imessage_recipients, site_title, site_description,
│         banner_message, daily_notifications_enabled, notify_send_hour,
│         notify_timezone, notify_last_sent_date)
├── value
├── updated_at

posts_fts (FTS5, standalone, application-synced)
├── post_id (UNINDEXED, FK → posts.id)
├── title, body, tags (space-separated), people (space-separated)

push_subscriptions            -- daily "On this day" Web Push (lazy ensurePushSchema)
├── id (PK, nanoid)
├── endpoint (unique), p256dh, auth   -- Web Push subscription
├── label (device label), created_at, last_success_at

day_share_links               -- unguessable "On this day" share links (lazy ensureDayShareSchema)
├── token (PK, random)
├── year, month, day           -- the pinned calendar day
├── created_at

media_metadata_raw            -- Phase 10.0: full extracted payloads kept verbatim (no re-scan)
├── id (PK, nanoid)
├── media_id (FK → media, cascade)
├── source (extractor/origin, e.g. exif | video_container | apple_photos)
├── payload (JSON)
├── created_at

media_sources                 -- Phase 10.0: origin refs for re-sync / backfill corroboration (10.3)
├── id (PK, nanoid)
├── media_id (FK → media, cascade)
├── kind (apple_photos | dropbox | icloud | google | filesystem | upload)
├── external_id (Apple UUID, Dropbox path, Takeout id, …)
├── content_hash, phash
├── match_method, match_confidence, matched_at
├── created_at

-- post_tags / post_people / post_albums each gain: source TEXT NOT NULL DEFAULT 'human'
--   (auto vs human, so regenerated auto data never clobbers manual curation)
```

### Data Model Notes
- **IDs**: nanoid everywhere — non-sequential prevents archive enumeration since post pages are publicly accessible
- **Slugs**: Posts, tags, people, albums all have auto-generated slugs. Duplicate titles → suffix (`-2`, `-3`). Untitled posts → date-based slug (`2023-10-15`, `2023-10-15-2`)
- **Thumbnails**: Pre-generated via `sharp` — avoids Vercel 1,000/month image optimization cap
- **File size**: Populated at upload time for storage monitoring and validation
- **Photoset layout**: Tumblr format string preserved during migration; new posts can set manually or auto-calculate
- **Post type `text`**: Covers imported Tumblr text, quote, link, and answer types. Audio posts skipped unless present (log if encountered).
- **Album covers**: Points to existing media item. Default: most recent photo. Admin-overridable.
- **Password hashing**: bcrypt hash in `site_settings`, never plaintext
- **Month/year tags**: NOT imported as tags — become post `date` field

## Additions since v1 (2026-06)

> Repo is now standalone (`candystoredev/family-album`); source at repo root
> `src/...` (older sections say `apps/thehoecks/`). Vercel root directory is `/`;
> `master` auto-deploys to production. Build version (commit SHA) is surfaced in
> the nav.

### Installable iOS PWA
`manifest.webmanifest` + service worker (`public/sw.js`, registered by
`ServiceWorkerRegister`), `apple-mobile-web-app-capable`, standalone display,
gold monogram icons, auto-refresh on re-foreground. Required because iOS only
exposes Web Push to a Home-Screen-installed PWA.

### Daily "On this day" notifications
- `lib/onThisDay.ts` → `getMemoriesForDate(month, day, year, limit, maxPerYear)`
  (previous years only); shared by the homepage teaser (3), the notification (3),
  and `/today` (6).
- `lib/push.ts` (web-push/VAPID), `push_subscriptions` table, `/api/notifications/{subscribe,unsubscribe,test,daily}`.
- Daily cron: GitHub Actions (`.github/workflows/daily-memories.yml`) → `POST /api/notifications/daily` authed by `CRON_SECRET`; honors admin send-hour + timezone.
- `/today` page (gold) + `TodayMemory`; deep-linked from the notification.

### On This Day share links
Unguessable token route `/m/[token]` (public, OG + Twitter card preview, gold)
backed by `day_share_links` + `POST /api/share/day` (session-gated mint/reuse).
`ShareDayButton` on `/today`. `/m` is in `middleware` public paths. **Never expose
precise GPS on `/m/` pages.**

### Settings
`/settings` + `SettingsClient` — per-device notification toggle + test; admin:
enable/hour/timezone, "send today's memory now", site title/description/banner,
iMessage recipients, change family password, and the timeline-layout preference.

### Design system (chrome only)
`Source Serif 4` added via `next/font` as the display voice; gold accent
`#c2a467` + paper-grain in nav/settings/upload; canvas `#1a1918`. Feed, lightbox,
post, and login intentionally keep blue `#427ea3`. Timeline layout (classic list
vs year rail) is a shared preference via `lib/useTimelineStyle.ts` (`localStorage`
key `hoecks_timeline` + a `hoecks_timeline_change` window event), driven by both
Settings and the nav FAB toggle.

### Capture dates
`lib/media/exif.ts` extracts the capture date from the original before
compression: photos via `exifr`; videos via dependency-free MP4/MOV atom parsing
(`moov/mvhd`, preferring Apple `com.apple.quicktime.creationdate` with its UTC
offset), filename fallback. `lib/datetime.ts` for zoned date parts.

### Rich media capture pipeline (Phase 10.1, write-only)
Every upload banks rich, durable per-media metadata into the additive columns
(see Schema / Phase 10.0). **Write-only so far**: ordering/grouping still read the
legacy `posts.date` — reads flip to the new columns in 10.2.

- **One date rule, client + server** — `lib/media/capture-date.ts`
  `resolveCaptureDate()` is the single source of truth. It takes provenance-tagged
  inputs and returns `{takenAt (UTC instant, for ordering), tzOffsetMin, localDate
  (capture-local day, for grouping), source, confidence}`. Naive EXIF is parsed to
  wall-clock components and the instant built with `Date.UTC(...)` — never
  `new Date(str)` — so client and server agree regardless of host timezone, and
  `localDate` is tz-independent. `source` ∈ exif_offset | video_meta | exif |
  filename | file_mtime | manual | upload_fallback.
- **Client extraction** — `lib/media/extract.ts` `buildCaptureInput()` reads the
  ORIGINAL before `compressImage` strips EXIF, using exifr `{reviveValues:false}`
  (raw EXIF string, never a tz-built Date) + the video container instant/offset;
  `sha256Hex()` computes `content_hash` of the original (photos). Sent per-item to
  the upload route; the server re-extracts with the same rule for the
  originals/iOS-Shortcut path that sends no payload.
- **Server identity/visual** — `lib/media/image-hash.ts`: `perceptualHash()`
  (dHash, 16 hex) + `dominantColor()`, computed from the generated thumbnail so
  live hashes match how the 10.3 backfill will phash stored thumbnails. Plus
  `aspect`, `orientation`, `original_filename`.
- **HEIC** — `compressImage` tries native canvas decode first (Safari), then falls
  back to a lazy `heic2any` (libheif WASM) decode on Chrome/Firefox; always emits
  JPEG. exifr reads HEIC EXIF directly, so capture is unaffected by the conversion.
- **GPS + device + raw (10.1c)** — `extractPhotoExtras()` (photos) reads GPS,
  camera/lens/exposure, and the full raw EXIF (JSON-sanitized). Server writes the
  `gps_*` / `camera_*` columns, a `media_metadata_raw` row (verbatim payload), and
  a `media_sources(kind='upload')` row. **GPS is never selected by any public
  read path** (verified: feed/onThisDay enumerate columns, no `gps_*`).
- **Tests**: `capture-date` (host-tz independence), `exif-pipeline` (exifr
  reviveValues contract), `heic`, `image-hash`, `extract`. Read-only
  `scripts/capture-check.ts` inspects the written columns. *Deferred: 10.1e
  (async enrichment queue + Railway worker; ML backends stubbed until 10.5).*

### Reads use the effective capture date (Phase 10.2)
Feed ordering, cursor pagination, archive/on-this-day grouping, and date display
now key off the **effective** capture date, computed at read time so the legacy
`posts.date` is never mutated (`lib/order.ts`):
- `ORDER_KEY = COALESCE(taken_at, normalized legacy date)` — captured posts sort
  by their true instant; everything else keeps its exact prior order. The two
  legacy formats and `taken_at` collapse to one comparable ISO string.
- `EFF_DAY = COALESCE(local_date, legacy day)` — month ranges + grouping.
- Display: `formatDisplayDate()` shows `local_date` tz-safely (no `new Date` on a
  bare day); an "est." badge marks fallback `date_source`
  (filename/file_mtime/upload_fallback). `tests/feed-order.test.ts` proves
  existing order is byte-identical and pagination has no dupes/skips;
  `tests/display-date.test.ts` proves tz-safety.
Populated only for posts since 10.1; historical content falls back via COALESCE
until the 10.3 backfill.

### New environment variables
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`. `NEXT_PUBLIC_SITE_URL`
canonical is `https://thehoecks.com`.

### Additions (2026-07)
Shipped but previously undocumented:
- `/favorites` page + `POST /api/favorites` — session-gated per-user favorites
- `/share/[token]` — public single-post share links, backed by `post_share_links` +
  `POST /api/admin/share` (admin mint, 30-day expiry)
- `/api/version` — build SHA surfaced in the nav
- `/api/admin/upload/ingest-fetch` — share-to-upload R2 proxy (see iOS Shortcut)
- Photo cropping on the edit page (PR #28, 2026-07-07) — server-side `sharp` crop;
  re-encodes and strips ALL EXIF from the served file, since capture data already
  lives in the DB
- PWA refresh/back controls (PRs #31–33)

### Additions (2026-07-11 — Phases 11–13 + backfill Indexer)
- **Backups (11a):** nightly GitHub Actions cron dumps Turso via the turso CLI's
  native `.dump` → gzip → private `thehoecks-backups` R2 bucket → prune to 30.
  `scripts/restore-drill.ts` (`npm run restore-drill`). See "Backup Strategy".
- **Served-photo EXIF strip (11d):** `src/lib/media/process-photo.ts`
  `processUploadPhoto()` re-encodes every served `original.jpg` via `sharp` (no
  `withMetadata`) → strips GPS/EXIF. Removed the `alreadyProcessed` fast path that
  served raw bytes. 50 MB upload cap (`src/lib/media/upload-limits.ts`). Videos are
  NOT stripped (no server ffmpeg — documented limitation).
- **Share-link revocation (11e):** `revoked` on `post_share_links` +
  `day_share_links`; public `/share/[token]` + `/m/[token]` reject revoked links via
  `src/lib/shareLinks.ts` `isShareLinkUsable()`; admin `GET/POST /api/admin/share-links`
  + Settings UI. No auto-expiry (links stay persistent by design).
- **FTS body fix (12c):** incremental `posts_fts` writes index the real body via
  `ftsRowFor()` (was `''`, which erased captions on every edit). A `/api/init`
  rebuild backfills historical bodies.
- **Feed enrichment unified (12d):** `src/lib/postAssembly.ts` centralizes the
  media/tags/people attachment for the SSR feed, `/api/feed`, `/api/search`, and
  on-this-day; `/api/feed`'s three queries now run in one `Promise.all`. Effective
  capture date drives archive/date display (12a/12b, `EFF_DAY_SQL` + `formatDisplayDate`).
- **Schema `PRAGMA user_version` guard (13b):** the four `ensure*Schema()` functions
  skip their DDL sweep once the DB is at `SCHEMA_VERSION` (1), stamped by
  `initializeSchema()` after a full apply (which now also runs `ensureDayShareSchema()`
  — `day_share_links` was the one lazy-only table). Kills ~50 cold-start `ALTER`s.
- **Dead code removed (13b):** `invite_links` table, `SeedButton`, `/api/seed`
  (seed logic → `scripts/seed.ts`), `@types/sharp`.
- **Security hygiene (13d):** shared `src/lib/slugify.ts`; `r2Key`/`keyPrefix`
  validated in both write routes; no `String(error)` leaks; push-subscribe host
  allow-list; inert JWT `tokenVersion` claim.
- **Backfill Indexer (10.3a) — `tools/backfill-indexer/` (Python, standalone):**
  the read-only Tool A for the historical backfill. Walks photo sources (filesystem
  done; Apple Photos/Google Takeout/XMP scaffolded), emits a portable SQLite index
  with a perceptual hash **byte-identical to the app's `perceptualHash`** (uses
  pyvips = the same libvips sharp wraps), content hash, and metadata. Idempotent,
  resumable, dry-run-able. Runs on the family's own machines; feeds Tool B (10.3b).

## Constraints

- Vercel free tier: 10-second function timeout, 4.5MB body limit (bypassed via presigned R2 URLs), 1,000 image optimizations/month (bypassed via pre-generated thumbnails)
- Turso free Starter: SQLite limitations apply
- R2: Free up to 10GB, then $0.015/GB/month
- Tumblr strips EXIF data — use API timestamps for post dates
- Videos stored directly (no transcoding)
- Non-sequential IDs required for publicly accessible post pages

## Deployment

### Infrastructure
| Component | Service | Tier |
|-----------|---------|------|
| Hosting | Vercel | Free (Hobby) |
| Media storage | Cloudflare R2 | Free up to 10GB |
| Database | Turso (SQLite) | Free Starter |
| Domain | thehoecks.com | Already owned |

### Environment Variables (Vercel Dashboard)
```
# Infrastructure (rarely change)
TURSO_DATABASE_URL        = libsql://thehoecks-[username].turso.io
TURSO_AUTH_TOKEN           = [from Turso CLI]
R2_ACCOUNT_ID              = [from Cloudflare dashboard]
R2_ACCESS_KEY_ID           = [from R2 API token]
R2_SECRET_ACCESS_KEY       = [from R2 API token]
R2_BUCKET_NAME             = thehoecks-media
R2_PUBLIC_URL              = https://pub-[hash].r2.dev
JWT_SECRET                 = [random 32+ char string]
ADMIN_API_TOKEN            = [random 32+ char string]
ADMIN_PASSWORD             = [random string]
NEXT_PUBLIC_SITE_URL       = https://thehoecks.com
```

### Operational Settings (DB `site_settings`, admin-changeable)
- `viewer_password_hash` — bcrypt hash of shared family password
- `imessage_recipients` — comma-separated phone numbers
- `site_title` — "The Hoecks"
- `site_description` — for OG meta tags

### Setup Steps

**Vercel**: Import GitHub repo `candystoredev/family-album` → Root Directory: `/` (repo root) → Framework: Next.js
- Production: `thehoecks.com` mapped to `master` branch
- (Historical: launched on `dev.thehoecks.com` while the old Tumblr site held `www.thehoecks.com`; `thehoecks.com` now points here.)

**Cloudflare R2**: Create bucket `thehoecks-media` → enable public access → create R2 API token (read + write)
- **CORS Policy** (required for browser uploads): In Cloudflare dashboard → R2 → bucket → Settings → CORS Policy, add a policy allowing `PUT` from all site origins. If the site domain changes, this must be updated or uploads will silently fail with a "Network error".
  - Allowed origins: `https://dev.thehoecks.com`, `https://thehoecks.com`, `https://www.thehoecks.com`, `http://localhost:3000`
  - Allowed methods: `PUT`
  - Allowed headers: `Content-Type`
  - Expose headers: `ETag`

**Turso**: `turso db create thehoecks` → get URL + auth token

**DNS**:
- Dev: CNAME `dev` → `cname.vercel-dns.com`
- Production: Vercel provides A records / CNAME at go-live

### Pipeline
- Push to branch → Vercel auto-builds preview deployments
- Merge to master → auto-deployed to `dev.thehoecks.com` (production)

### Backup Strategy
- **Baseline**: `turso db dump` immediately after migration — known-good snapshot
- **Ongoing (Phase 11a — built)**: `.github/workflows/backup.yml` runs daily (04:00 UTC,
  plus manual `workflow_dispatch`). It installs the turso CLI, runs
  `turso db shell "$TURSO_DATABASE_URL?authToken=$TURSO_AUTH_TOKEN" ".dump"` (the raw-URL
  form needs no separate Turso platform token), validates the dump is non-empty and
  contains `CREATE TABLE` (fails loudly otherwise — a truncated silent upload is worse
  than no backup), gzips it, and uploads to a **separate, PRIVATE** R2 bucket,
  `thehoecks-backups` (public access OFF) — **backups must never go in the public
  `thehoecks-media` bucket**. Key: `backups/thehoecks-YYYY-MM-DD.sql.gz`.
  `.dump` is used (not a hand-rolled row export) because it's the only thing that
  correctly serializes the `embedding` BLOB column and the `posts_fts` FTS5 virtual
  table. After upload, the workflow prunes the bucket to the most recent 30 dumps.
- **Restore drill**: `npm run restore-drill` downloads the latest backup (or takes
  `--file <path>` for a local `.sql`/`.sql.gz`), restores it into a throwaway local
  SQLite file via `@libsql/client`, and checks: `posts`/`media` tables exist and have
  rows, `posts_fts` is present, and an FTS `MATCH` query runs cleanly. Run
  `npm run restore-drill -- --self-test` to exercise the same restore/verify logic
  against a generated fixture with no prod credentials.
- **Restore procedure (runbook)**: gunzip the chosen `backups/*.sql.gz`, load it into a
  fresh Turso DB (`turso db shell "$URL?authToken=$TOKEN" < dump.sql`), repoint
  `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`, then **run `POST /api/init` to rebuild the FTS
  index** rather than trusting the dumped index — `posts_fts` is derived data and its
  restore fidelity from a `.dump` is version-dependent, whereas `rebuildFtsIndex()`
  reconstructs it deterministically from `posts`/`post_tags`/`post_people`. Everything
  that matters (posts, media, tags, people, junctions, `site_settings`) is source-of-truth
  in the dump; the FTS index is the one thing you rebuild afterward.
- **Required GitHub Actions secrets** (repo Settings → Secrets → Actions):
  `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BACKUP_BUCKET` (= `thehoecks-backups`).
- R2 media is durable (Cloudflare infrastructure); database is single point of failure
- Store dumps locally and/or in R2

### Estimated Costs
- ~$0-2/month total
- 50GB photos = ~$0.60/month on R2, zero egress fees
