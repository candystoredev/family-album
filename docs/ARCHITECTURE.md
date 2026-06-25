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
- Privacy controls (auth, invite links)
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
media/{media_id}/original.{ext}   — full-size original
media/{media_id}/thumb.{ext}      — optimized thumbnail for feed
```
Extensible: future variants added as sibling files without schema changes.

### Database (Turso / SQLite)
- **Turso** free Starter plan with FTS5 full-text search
- FTS5 standalone table (`posts_fts`) — not external content mode, synced at application level
- Indexed fields: `post_id` (unindexed key), `title`, `body`, `tags` (space-separated names), `people` (space-separated names)
- `rebuildFtsIndex()` rebuilds from `posts` + `post_tags`/`tags` + `post_people`/`people` joins
- Rebuild triggered by `POST /api/init`; future: also after post create/update/delete

### Authentication & Access Control
- **Viewer access (two paths)**:
  1. **Invite link**: `/invite/[token]` — auto-sets session cookie, no password needed. Admin can label, expire, revoke.
  2. **Shared password**: Admin-changeable from settings page. Stored as bcrypt hash in `site_settings`.
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
1. Client requests presigned upload URL(s) from API
2. Client uploads original directly to R2 via presigned URL
3. Client calls `POST /api/posts` with metadata + R2 keys
4. API route fetches original from R2, generates thumbnail via `sharp`, uploads thumbnail to R2
5. API saves post record with both R2 keys

Step 4 constraints: R2 → Vercel fetch is fast (Cloudflare network), `sharp` resizes typical iPhone photo (3-8MB) in <1 second, thumbnail upload (~100KB) near-instant. Within Vercel 10-second function timeout. For unusually large files, the API can stream the download rather than buffering the full file.

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
3. `GET /api/presigned-upload` (Bearer token auth) → presigned R2 URL per file
4. Upload each file directly to R2
5. `POST /api/posts` with metadata + media keys
6. Server generates thumbnails; continues in background if user switches apps
7. EXIF date extracted → pre-fills post date

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

invite_links
├── id (PK, nanoid)
├── token (unique, random)
├── label (optional, e.g., "Grandma's link")
├── created_at
├── expires_at (nullable)
├── revoked (boolean)

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
- **Pure-core tests**: `tests/capture-date.test.ts` (incl. host-tz independence),
  `tests/exif-pipeline.test.ts` (exifr reviveValues contract), `tests/heic.test.ts`,
  `tests/image-hash.test.ts`. Read-only `scripts/capture-check.ts` inspects the
  written columns. *Pending: 10.1c (GPS/device + `media_metadata_raw` +
  `media_sources`), 10.1e (async enrichment queue + Railway worker).*

### New environment variables
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`. `NEXT_PUBLIC_SITE_URL`
canonical is `https://thehoecks.com`.

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
NEXT_PUBLIC_SITE_URL       = https://dev.thehoecks.com
```

### Operational Settings (DB `site_settings`, admin-changeable)
- `viewer_password_hash` — bcrypt hash of shared family password
- `imessage_recipients` — comma-separated phone numbers
- `site_title` — "The Hoecks"
- `site_description` — for OG meta tags

### Setup Steps

**Vercel**: Import GitHub repo `tom-playground` → Root Directory: `apps/thehoecks` → Framework: Next.js
- Production: `dev.thehoecks.com` mapped to master branch (old Tumblr site still on `www.thehoecks.com`)
- Future: `thehoecks.com` will point here at go-live (Phase 8)

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
- **Ongoing**: Periodic `turso db dump` — manual monthly reminder for v1; automated cron in V2 backlog
- R2 media is durable (Cloudflare infrastructure); database is single point of failure
- Store dumps locally and/or in R2

### Estimated Costs
- ~$0-2/month total
- 50GB photos = ~$0.60/month on R2, zero egress fees
