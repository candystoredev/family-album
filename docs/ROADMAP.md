# Roadmap

## Completed

### Phase 1 — Foundation & Schema
- Next.js + Tailwind initialized at `apps/thehoecks/`
- Turso connection + full schema (all tables, FTS5, indexes, sync triggers)
- Seed `site_settings` with defaults (viewer password hash, site title/description, iMessage recipients)
- Auth: shared password login + session cookie middleware + admin bearer token validation
- All routes protected; admin routes gated separately
- Dark theme skeleton layout
- `robots.txt` blocking all crawlers
- Deployed to dev.thehoecks.com
- Verified: dev starts, Turso connects, login works, logout blocks, admin route returns 403 without admin auth, Vercel deploy succeeds

### Phase 2 — First Vertical Slice
- Test media upload to R2 (photo, video, multi-photo)
- Seed posts with R2 key references
- Chronological feed behind auth with dark theme
- Full stack proven end-to-end (Turso → API → R2 media → browser)
- Verified: Login → posts with photos/videos from R2 → dark theme correct on desktop and phone
- Test: Unit tests for slug generation (duplicate titles, untitled fallbacks, date-based slugs, suffix incrementing)

### Phase 3 — Migration Script
- Tumblr API v2 pagination with rate-limit handling
- All post types handled: photo/video → `photo`/`video`/`mixed`; text/quote/link/answer → `text`
- HTML sanitization on captions/bodies
- Media download → R2 upload with thumbnails via `sharp`, video posters via Tumblr poster frames
- People/tag split based on configurable people list
- Slug generation with dedup suffixing
- Photoset layout strings preserved
- File size recorded per media item
- Dry-run mode, offset/limit support, skip-if-already-migrated
- Output summary (counts by type, skipped items with reasons)
- Post-migration: `turso db dump` for baseline backup
- Staged testing: 10 posts → 100 posts → full migration (see ARCHITECTURE.md for details)
- Verified: Post count matches Tumblr, no orphaned media/records, people/tags split correctly, feed renders all content
- **2026-03-07**: Full production migration completed, FTS index rebuilt, site live with all content

## Completed (continued)

### Phase 4 — Public Site — **DONE**
Dark theme: same concept as Tumblr, refined/sharper/modern. Mobile-first. Each sub-slice deployed and verified before next.

- **4a** ~~Polished feed + cursor-based infinite scroll~~ — **DONE**
  - Cursor-based pagination with `(date, id)` tiebreaker
  - IntersectionObserver infinite scroll with 600px lookahead
  - SSR first page, client-side subsequent pages via `/api/feed`
  - Edge-to-edge images on mobile, rounded corners on desktop
  - 25-post seed script for testing pagination
- **4b** ~~Post page + OG tags + iMessage button~~ — **DONE**
  - Post page at `/posts/{slug}` with OG tags for link previews
  - iMessage button on every post in feed (pre-filled SMS with post URL)
  - `X-Robots-Tag` + `noindex` on post pages
- **4c** ~~Multi-photo grid/mosaic + lightbox~~ — **DONE**
  - `photoset_layout` grid rendering matching Tumblr layouts
  - Full-screen lightbox with swipe, keyboard arrows, dot indicators
  - Image preloading, backdrop close, body scroll lock
- **4d** ~~Tag, People, Album filtered pages~~ — **DONE** ✓ verified with real data
  - `/tags/{slug}`, `/people/{slug}`, `/albums/{slug}` with cursor-based infinite scroll
  - Feed API extended with `tag`, `person`, `album` filter params
  - Feed shows clickable `@person` and `#tag` links per post
  - Album cover image display
  - Shared `lib/feed.ts` for server-side feed fetching
  - Verified: Tag/people/album pages render with real migrated content, pagination works within filters
- **4e** ~~Year/month timeline navigation + month pages (oldest-first)~~ — **DONE**
  - Floating action button (bottom-right) with hamburger/X toggle, hides on scroll-down, shows on scroll-up
  - Slide-out panel from left: "The Latest", "Featured" (albums), expandable year/month timeline
  - Archive API returns years/months with post counts + albums list
  - Archive index at `/archive` — year/month grid (fallback direct URL)
  - Month pages at `/archive/{year}/{month}` — oldest-first infinite scroll
  - Previous/next month navigation at bottom of month pages
  - Feed API extended with `year`+`month` filter params, oldest-first ordering
  - Verify: FAB visible, slide-out opens with timeline, navigate to month → oldest-first order
- **4f** ~~FTS5 search~~ — **DONE**
  - Search bar in slide-out panel, navigates to `/search?q=` results page
  - Search API at `/api/search` with FTS5 ranking, offset-based "load more" pagination
  - FTS5 indexes title, body, tags, and people names (standalone table, not trigger-based)
  - `rebuildFtsIndex()` function; init endpoint rebuilds FTS on deploy
  - Search results rendered in standard feed format with full media
  - Verify: Search "birthday" → finds birthday posts. Search person name → finds their posts. Empty search handled
- **4g**: Crawler blocking hardening (`noindex` meta, `X-Robots-Tag` header)
  - Verify: `curl -H "User-Agent: Googlebot"` → response contains `noindex` meta + `X-Robots-Tag` header. OG tags still work
- **4h**: Post-migration polish (feedback from real-content review) — **DONE**
  - Feed image quality: serve originals instead of 400px thumbnails in feed
  - Desktop navigation: persistent left sidebar (semi-transparent, full opacity on hover, tucks away on narrow screens)
  - Header removal: remove sticky header, replace with optional banner message
  - Sidebar tuck behavior: tucks left when overlapping feed, slides in on hover with background
  - iMessage bubble: mobile only (hidden on desktop)
  - Center-aligned post text with padding, tags inline with date
  - Subtle post dividers, shorter date format (Nov 27, 2025), left-aligned body text
- **4i**: ~~Delight & performance polish~~ — **DONE**
  - Double-tap to "heart" photos in feed (floating heart animation, hearts stored in localStorage)
  - Image fade-in on load (prevent layout shift, smooth reveal)
  - "On this day" — full expanded feature: thumbnail row, swipeable memory cards, desktop nav arrows, dot indicators, lightbox integration. Shows 3 posts from 2+ different years matching today's month/day
  - Randomized end-of-feed messages (playful family-themed messages instead of static text)
  - Skeleton loading shimmer for infinite scroll (instead of plain spinner)
  - Smooth scroll-to-top when tapping "The Latest" in sidebar
  - Prefetch next page of feed for instant infinite scroll
  - Known polish items deferred: nav button overlap on some viewports, single-image memory card sizing on narrow screens

## Up Next

### Phase 5 — Admin Panel & Settings
Responsive web throughout (not PWA). Each sub-slice builds on previous.

- **5a**: Single photo upload (presigned URL → R2 → server thumbnail via `sharp` → DB)
  - Verify: Upload photo → appears in feed with thumbnail. Check R2 bucket for both `original.jpg` and `thumb.jpg`
- **5b**: Full upload form (multi-file, title, date, tags, people, albums, drag-reorder, video poster capture via canvas)
  - Verify: 4-photo post with tags/people → grid + tag/people links. Video → poster frame + playback. Drag-reorder works
- **5c**: Edit + delete posts (with R2 cleanup)
  - Verify: Edit title → updated in feed + post page. Add photo → grid updates. Delete post → gone from feed + R2 cleaned
- **5d-flag**: Post flagging & review queue
  - `post_flags` table: `id`, `post_id`, `note`, `created_at`, `resolved_at`
  - In feed: admin sees flag icon (replaces iMessage bubble position) → tap opens inline note input → creates flag
  - `/admin/review` page: lists unresolved flagged posts with notes, sorted by flag date
  - Edit view from review queue: edit title/body/date, add/remove/reorder photos, tag/untag people, mark resolved
  - Reuses edit form from 5c
  - Verify: Flag post in feed → appears in review queue with note. Edit from queue → changes reflected. Mark resolved → removed from queue
- **5d**: Settings page (change viewer password, manage invite links, update iMessage numbers, edit site metadata)
  - Verify: Change password → old fails, new works. Create invite → incognito auto-auth. Revoke → rejected. Update iMessage → reflected
  - Test: Automated auth middleware tests (viewer JWT blocked from admin, expired/revoked invites rejected, valid invite sets cookie)
- **5e**: Tech stack overview page — at-a-glance view of infrastructure (Vercel, Turso, R2, Doppler, domain/DNS)
- **5f**: Changelog — track what's been built and when, visible from admin UI
- **5g**: Admin tabs — separate tabs for Settings, Tech Stack, Changelog

### Phase 6 — iOS Shortcut
- Shortcut definition + setup guide
- Uses ADMIN_API_TOKEN (iOS Keychain)
- Supports: single photo, multi-photo, video, mixed
- Flow: Select photos → Share → fill title/tags → presigned upload to R2 → `POST /api/posts` → server thumbnail
- EXIF date extraction → pre-fill post date
- Continues in background if user switches apps
- Verify: On iPhone — select 3 photos → share → shortcut → fill title/tags → post appears on dev.thehoecks.com with thumbnails, tags, EXIF date

### Phase 7 — Performance & Polish
- Performance optimization with real content (no visual redesign — styling done in Phase 4)
- Loading states and perceived performance
- Cross-browser/mobile testing (Safari, Chrome, Firefox — desktop and phone)
- Accessibility pass (keyboard nav, screen reader, color contrast)
- Verify: Lighthouse performance score. Feed loads quickly on throttled mobile. All elements keyboard-accessible. No layout shifts

### Phase 8 — Go Live
- Final review of all content on dev.thehoecks.com
- DNS update: thehoecks.com → Vercel production
- Merge to master → auto-deploy
- Verify: Production end-to-end (login → feed → post → iMessage → search)
- Share invite links with family

### Phase 9 — Bulk Import

Desktop and tablet only (mobile shows a friendly fallback card linking to `/admin/upload`). A catch-up import tool for adding large batches of photos at once — the primary use case is uploading historical photos that predate the Tumblr era or weren't captured in the migration.

#### Concept
Select many images at once → client reads EXIF dates → app auto-groups them into suggested posts based on timestamp proximity → admin reviews and adjusts groups (merge/split buttons first, drag-and-drop as polish) → fills in metadata per group → publishes all as separate posts in one action.

#### Sub-phase ordering
9-pre through 9c form a complete, usable tool (mis-groupings fixable via merge/split). 9d (cross-group drag) and 9e (zoom) are polish. Resequenced from the original plan so the end-to-end path ships first.

#### Sub-phases

- **9-pre — Shared extraction (refactor, no new behavior)**
  - `src/lib/media/compress.ts` — move `compressImage` out of the upload page
  - `src/lib/media/exif.ts` — `exifr` wrapper: `getExifDate(file)` → `{ date, source }` with fallback chain: `DateTimeOriginal` → `CreateDate` → filename pattern (`YYYYMMDD` / `YYYY-MM-DD`) → `file.lastModified`
  - `src/lib/media/layout.ts` — move `defaultLayout` (upload page) + `generatePhotosetLayout` (complete route) into one module; they encode the same rules and are currently duplicated
  - `src/components/MetadataFields.tsx` — title/date/tags/people/albums field group extracted from the upload page (edit page can adopt later)
  - **Fixes a standing bug while here**: client-side compression re-encodes via canvas, which strips EXIF — so for photos >1920px the server's EXIF date detection silently fails and posts get the upload date. Single upload now reads the EXIF date client-side and passes `date` to complete.
  - Verify: single upload behavior unchanged except large photos now get correct EXIF dates. Unit tests for exif fallback chain + layout parity.

- **9a — Ingest + auto-grouping + merge/split**
  - `/admin/bulk-import` page, multi-file picker (no hard cap; 50–200 images must stay smooth)
  - Two-pass ingest: (1) EXIF date pass — header-only reads via `exifr`, progress text ("Reading photo 120/200…"), groups render immediately with shimmer placeholders; (2) thumbnail pass — previews generated progressively (`createImageBitmap(file, { resizeWidth: 320 })` → canvas → blob URL), small worker queue (~4 concurrent)
  - **Memory rules**: never render an object URL of the original file — previews are ≤320px generated blobs; `content-visibility: auto` + `contain-intrinsic-size` on cards so offscreen cards don't render
  - Grouping: pure function `groupByGap(items, thresholdMs)` in `src/lib/media/grouping.ts`, unit-tested
  - Threshold control: segmented "1 hr / 6 hrs / 1 day" in the toolbar — regroups live (pure recompute, instant); locks with a note after the first manual group edit so it can't destroy manual work
  - Group cards in CSS grid (`grid-template-columns: repeat(var(--bulk-cols), 1fr)`, default 3); mini photo grid per card via shared `defaultLayout`
  - **Merge/split**: each card has a "merge into previous group" button; hovering between two photos inside a card shows a "split here" divider — these two cover the common mis-grouping cases without any drag-and-drop
  - Date-source badge on cards whose date came from filename/mtime fallback (tiny icon + tooltip) — trust signal for old scanned photos
  - `beforeunload` confirm guard whenever unpublished work exists
  - Verify: 40 photos spanning 3 days → groups split at day boundaries. Threshold change regroups live. Merge then split round-trips. EXIF-less file lands via mtime with badge. 200-photo selection: no tab jank, memory stays flat while scrolling.

- **9b — Per-group metadata editing**
  - Each card: title, date (pre-filled from group's earliest EXIF date), tags, people, albums — via shared `MetadataFields`
  - "Apply to all" shortcut for tags, people, and albums
  - "Skip this group" toggle per card — excluded from publish without deleting from view
  - Toolbar summary: "12 posts · 47 photos · 2 skipped"
  - Verify: Set title on one card. Apply tags to all. Toggle skip → excluded from count. Date pre-filled from first image EXIF.

- **9c — Batch publish**
  - Per-group pipeline, no global barrier: compress (lazily, at upload time — never eagerly for 200 files) → presign → direct R2 PUT → when the group's files are done → `/api/admin/upload/complete` with the group's metadata, explicit `date`, and auto `photosetLayout`. Finished groups publish while slower ones still upload.
  - Global concurrency caps: 5 simultaneous file PUTs, 3 simultaneous complete calls
  - **Always pass the group's `date` explicitly** — compression strips EXIF, so the server cannot recover it
  - Per-card status: progress ring → Uploading → Processing → Published / error with retry (retry re-runs only that group's failed steps)
  - On full completion: summary toast ("12 posts published") + link to feed
  - Skipped groups are not published
  - Existing presign and complete endpoints are reused without modification
  - Verify: Publish 10 groups → all appear in feed with correct media **and correct EXIF dates (not today's date)**. Skipped group absent. Failed group shows retry; other groups unaffected. Progress rings update in real time.

- **9d — Cross-group drag-and-drop (polish)**
  - Semantics: **membership + linear order only** — row layout inside a group is always auto-generated (`defaultLayout`); per-post layout fiddling remains the edit page's job
  - Standard `@dnd-kit` multi-container pattern: each card a droppable, photos draggable, `rectIntersection` collision; thin droppable gaps between cards create a new group at that position
  - **Do not port the upload form's drag code** — it is custom pointer hit-testing against `[data-row]`/`[data-item]` (not `SortableContext`), built for row-level placement that bulk import doesn't need
  - Removing the last photo from a group deletes the group
  - Verify: Move photo A→B → both cards update. Drag to gap → new group. Remove last photo → group disappears.

- **9e — Zoom control (polish)**
  - Range slider in toolbar sets `--bulk-cols` (2–6), persisted in `localStorage`
  - **Trackpad pinch**: `wheel` events with `ctrlKey: true`; `deltaY` accumulates and steps `--bulk-cols`; `preventDefault()` scoped to the bulk import page
  - **Touchscreen pinch**: 2-touch distance delta → column step changes
  - Card content adapts via **container queries** (Tailwind v4 `@container`): below ~280px card width, metadata collapses to a one-line summary; full form at wide widths. One markup, no JS branching on column count.
  - Verify: Slider drag resizes smoothly. Trackpad and iPad pinch both work without browser zoom. Content collapses/expands at extremes.

#### Technical notes
- No content-based image grouping in v1 — timestamp proximity only. ML-based clustering (scene similarity, face grouping) is a future enhancement if demand exists.
- EXIF parsing is entirely client-side — no server round-trip before upload, no Vercel function involved.
- R2 uploads are direct presigned PUT (same as existing upload flow) — Vercel function timeout is not a constraint for file transfer. Complete calls process whole groups server-side; the 1-hour gap rarely produces giant groups, but if a group exceeds ~20 photos, show a soft hint to split it.
- Memory is the scaling constraint, not network: 200 full-resolution image decodes would consume GBs of RAM. All previews are small generated thumbnails; originals are only read at compress-and-upload time.

#### Verify (full phase)
- Mobile: `/admin/bulk-import` on a phone shows the fallback card linking to `/admin/upload`
- Select 80 photos spanning a long weekend → groups are sensible, no photos missing
- Adjust threshold → regroups live; after a manual merge, threshold control locks
- Pinch-zoom on trackpad and iPad both work without triggering browser zoom
- Drag photo between groups, drag to gap (new group), remove last photo (group gone)
- Publish 15 groups → all 15 posts in feed, thumbnails correct, tags/people assigned, dates match EXIF
- One upload failure → retry works, other groups unaffected
- Close tab with unpublished work → browser confirm appears

---

## Backlog (V2 — Post-Launch)

Schema can accommodate all V2 features without breaking changes.

### Category Management
- Tag display names (e.g., "perform" → "Performances"), descriptions, custom sort order
- People profiles (display name, `profile_photo_r2_key`, description, sort order)
- Album custom sort order

### Admin Enhancements
- Change admin password from settings (v1: env var only)
- Default tags/people quick-pick lists for upload form
- Posts-per-page tuning
- Site banner image upload
- Bulk operations (multi-select posts for tag/album assignment)

### Content Features
- ~~"On this day" — surface posts from same date in past years~~ (built in 4i)
- Favorites / pinned posts
- Download original photo button
- Print-friendly view

### UX & Delight
- **Favorites heart in action sheet** — heart button in the long-press sheet (all users); joyful fill animation on tap; persisted per-user. Replaces or extends the double-tap heart from 4i.
- **Slide-out menu redesign** — current panel is functional but visually rough. Redesign to match the feed's dark aesthetic and typography more closely. Goal: joyful, easy to navigate, aesthetically consistent. Consider Claude Design for the visual pass.

### Search & Discovery
- Search by date range
- Filter by multiple tags/people simultaneously
- "Related posts" suggestions

### Media
- Video thumbnail frame picker (v1: auto poster frame)
- Multiple thumbnail sizes (feed vs. lightbox vs. OG) — R2 key convention supports this (`media/{id}/thumb_lg.{ext}`, etc.)
- HEIC → JPEG conversion on upload

### Analytics (Lightweight)
- Most-viewed posts (simple counter, no third-party tracking)
- Invite link usage stats

### Infrastructure
- Automated backup schedule (cron → `turso db dump` → R2)
- Staging environment

## Testing Strategy

**Automated tests** (written as they come up):
- Slug generation (duplicates, untitled fallbacks, suffix logic)
- Cursor-based pagination (ordering, tiebreakers, no skips/dupes)
- Auth middleware (viewer can't reach admin, expired invite rejected, valid invite sets cookie)
- FTS5 search (insert posts, verify results match)

**Manual verification**: Against dev.thehoecks.com on desktop and phone.

Each phase has a verify checklist — phase isn't done until every item passes.
