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

Desktop and tablet only (hard `md:` breakpoint gate; mobile redirected to `/admin/upload`). A catch-up import tool for adding large batches of photos at once — the primary use case is uploading historical photos that predate the Tumblr era or weren't captured in the migration.

#### Concept
Select many images at once → app auto-groups them into suggested posts based on timestamp proximity → admin reviews and adjusts groups via drag-and-drop → fills in metadata per group → publishes all as separate posts in one action.

#### Sub-phases

- **9a — File ingest + auto-grouping**
  - Multi-file picker (no hard cap; handle 50–200 images gracefully)
  - Client-side EXIF extraction (`exifr` library — lightweight, no server round-trip)
  - Sort all images by EXIF datetime (fallback: filename, then file modification time)
  - Gap threshold: consecutive images more than 1 hour apart start a new group (threshold configurable in a constant, not exposed in UI v1)
  - Groups rendered as "post cards" in a responsive CSS grid — each card shows a mini photo grid using the existing `PhotoGrid` layout logic
  - No drag-and-drop yet; groups are static for review
  - Verify: Select 40 photos spanning 3 days → groups split correctly at day boundaries. Single-photo group renders. 5-photo group shows correct grid.

- **9b — Cross-group drag-and-drop**
  - Extend `@dnd-kit` (already in project) to support multiple sortable containers
  - Drag any photo from one group card to another group card
  - Drag a photo to the gap between cards → creates a new single-photo group at that position
  - Removing all photos from a group → group is deleted automatically
  - Within-group reorder also supported (same pattern as existing upload form)
  - Verify: Move photo from group A to group B → both cards update. Drag to gap → new group created. Remove last photo from group → group disappears.

- **9c — Zoom control**
  - Range slider (bottom toolbar or top-right) controls the number of columns in the card grid
  - Maps range to CSS custom property `--bulk-cols` (values 2–6; fewer columns = larger cards)
  - **Trackpad pinch**: listen for `wheel` events with `ctrlKey: true` (browser fires these for pinch gestures on trackpad); `deltaY` adjusts `--bulk-cols` with a small damping factor to avoid jumpy response
  - **Touchscreen pinch**: `touchstart` / `touchmove` with 2 touches; track distance between `touches[0]` and `touches[1]`; compare to baseline distance to derive scale delta → map to column step changes
  - Card content (photo grid, metadata fields) scales proportionally; at minimum zoom (6 cols), metadata inputs collapse to a single-line summary; at maximum zoom (2 cols), full metadata form is visible
  - Slider position persists in `localStorage` across sessions
  - Verify: Slider drag changes card size smoothly. Two-finger pinch on trackpad zooms. Pinch on iPad zooms. Content collapses/expands correctly at extremes.

- **9d — Per-group metadata editing**
  - Each card: title, date (pre-filled from EXIF), tags, people, albums — same field components as existing upload form
  - "Apply to all" shortcut for tags/albums (common case: all photos from an event share tags)
  - Card has a "Skip this group" toggle to exclude it from the publish batch without deleting it from view
  - Group count + photo count summary in toolbar ("12 posts, 47 photos")
  - Verify: Set title on one card. Apply tags to all. Toggle skip on a card → excluded from count. Date pre-filled from first image EXIF.

- **9e — Batch publish**
  - Toolbar "Publish all" button (disabled until at least one group has completed R2 uploads)
  - Upload phase runs first: presign → direct R2 upload per photo, with concurrency capped at 5 simultaneous uploads across all groups to avoid saturating the connection
  - Per-card progress ring during upload phase
  - Publish phase: call `/api/admin/upload/complete` per group, max 3 concurrent, in order
  - Per-card status: Uploading → Processing → Published → (error state with retry)
  - On full completion: summary toast ("12 posts published") + link to feed
  - Skipped groups are not published
  - Existing presign and complete endpoints are reused without modification
  - Verify: Publish 10 groups → all appear in feed with correct media. Skipped group absent. Failed group shows retry button. Progress rings update in real time.

#### Technical notes
- No content-based image grouping in v1 — timestamp proximity only. ML-based clustering (scene similarity, face grouping) is a future enhancement if demand exists.
- EXIF parsing is entirely client-side — no server round-trip before upload, no Vercel function involved.
- R2 uploads are direct presigned PUT (same as existing upload flow) — Vercel function timeout is not a constraint here.
- The zoom pinch listener should call `preventDefault()` on `wheel` events with `ctrlKey` to suppress the browser's own page zoom — only within the bulk import page, not globally.
- `@dnd-kit`'s multi-container support (`DndContext` wrapping multiple `SortableContext` instances) is the right primitive. Each group card is its own `SortableContext`; photos can be dragged between them via `onDragOver` container detection.

#### Verify (full phase)
- Mobile: navigating to `/admin/bulk-import` on a phone redirects to `/admin/upload`
- Select 80 photos spanning a long weekend → groups are sensible, no photos missing
- Pinch-zoom on trackpad and iPad both work without triggering browser zoom
- Drag photo between groups, drag to gap (new group), remove last photo (group gone)
- Publish 15 groups → all 15 posts appear in feed, thumbnails correct, tags/people assigned
- One upload failure → retry works, other groups unaffected

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
