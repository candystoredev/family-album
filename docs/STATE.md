# State

## Current Status
Live in production, auto-deployed from `master` via Vercel (project `thehoecks`,
canonical `thehoecks.com`). Tumblr migration completed 2026-03-07. Beyond the
original v1: an installable iOS PWA, daily "On this day" push notifications, a
Settings page, a gold "keepsake" design pass over the chrome, and unguessable
On-This-Day share links are all live.

> **Repo move:** the project is now its own repo (`candystoredev/family-album`)
> with source at repo-root `src/...`. The `apps/thehoecks/` prefix throughout the
> older "Relevant Files" / "Recent Changes" entries below is historical — read it
> as `src/...`.

## Active Branch
`master` (work is done on short-lived branches, fast-forward merged, then pushed —
each push auto-deploys to production).

## Current Task
None active. Next planned initiative: **Phase 10 — Rich Media Metadata &
Enrichment** (see ROADMAP.md + `docs/rich-metadata-plan.md`). Start with 10.0
(schema) + 10.1 (capture + real-time enrichment at upload).

## Blockers
None

## Known Issues
- Docs (ARCHITECTURE/DECISIONS/ROADMAP) predate the standalone-repo move; paths
  reference `apps/thehoecks/` — actual paths are `src/...`.
- HEIC photos can fail client-side canvas compression on non-Safari browsers
  (to be fixed in Phase 10.1).
- Undated media (no EXIF / no video container date / no filename date) still
  falls back to upload time (Phase 10.2 adds an "estimated date" UX).

## Recent Changes

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
- `apps/thehoecks/src/app/admin/posts/[postId]/edit/page.tsx` — edit page: pre-populated form, manage existing+new media, drag-reorder, delete post
- `apps/thehoecks/src/app/api/admin/posts/[postId]/route.ts` — GET (post data for edit form), PUT (save edits), DELETE (post + R2 cleanup)
- `apps/thehoecks/src/app/admin/upload/page.tsx` — multi-file upload page with drag-reorder, tag/people/album pickers, video poster capture
- `apps/thehoecks/src/app/api/admin/upload/presign/route.ts` — presigned URL generation (photos + videos)
- `apps/thehoecks/src/app/api/admin/upload/complete/route.ts` — multi-file processing, tag/people/album assignment, FTS update
- `apps/thehoecks/src/app/api/admin/tags/route.ts` — tag autocomplete API
- `apps/thehoecks/src/app/api/admin/people/route.ts` — people autocomplete API
- `apps/thehoecks/src/app/api/admin/albums/route.ts` — album autocomplete API
- `apps/thehoecks/src/app/page.tsx` — home feed (SSR first page)
- `apps/thehoecks/src/components/Feed.tsx` — infinite scroll client component with tag/people links
- `apps/thehoecks/src/app/api/feed/route.ts` — cursor-based feed API with filter support
- `apps/thehoecks/src/lib/feed.ts` — shared server-side feed fetching logic
- `apps/thehoecks/src/app/tags/[slug]/page.tsx` — tag filtered page
- `apps/thehoecks/src/app/people/[slug]/page.tsx` — person filtered page
- `apps/thehoecks/src/app/albums/[slug]/page.tsx` — album filtered page
- `apps/thehoecks/src/app/archive/page.tsx` — archive index (year/month grid)
- `apps/thehoecks/src/app/archive/[year]/[month]/page.tsx` — month page (oldest-first)
- `apps/thehoecks/src/app/api/archive/route.ts` — archive API (years/months/counts + albums)
- `apps/thehoecks/src/components/ArchiveMenu.tsx` — floating menu button + slide-out panel + search
- `apps/thehoecks/src/app/api/search/route.ts` — FTS5 search API
- `apps/thehoecks/src/app/search/page.tsx` — search results page (server wrapper)
- `apps/thehoecks/src/app/search/SearchResults.tsx` — search results client component
- `apps/thehoecks/tests/cursor-pagination.test.ts` — cursor pagination tests
- `apps/thehoecks/src/app/login/page.tsx` — login page
- `apps/thehoecks/src/middleware.ts` — auth middleware
- `apps/thehoecks/src/lib/auth.ts` — session/JWT/password logic
- `apps/thehoecks/src/lib/db.ts` — Turso client
- `apps/thehoecks/src/lib/r2.ts` — R2 upload/delete
- `apps/thehoecks/src/lib/schema.ts` — all table definitions + FTS5
- `apps/thehoecks/src/app/posts/[slug]/page.tsx` — individual post page with OG tags
- `apps/thehoecks/src/components/PhotoGrid.tsx` — multi-photo grid + layout parser
- `apps/thehoecks/src/components/Lightbox.tsx` — fullscreen image viewer with swipe
- `apps/thehoecks/src/components/LogoutButton.tsx` — logout UI
- `apps/thehoecks/src/components/SeedButton.tsx` — seed test data UI
- `apps/thehoecks/src/app/api/init/route.ts` — schema init + settings seed
- `apps/thehoecks/src/app/api/seed/route.ts` — test data seeder (25 posts)
- `apps/thehoecks/src/app/api/auth/login/route.ts` — login endpoint
- `apps/thehoecks/src/app/api/auth/logout/route.ts` — logout endpoint
- `apps/thehoecks/src/app/robots.txt/route.ts` — crawler blocking
- `apps/thehoecks/scripts/migrate.ts` — Tumblr migration script

## AI Guardrails
Assumptions:
- Phases 1-4 are considered complete per ROADMAP.md phase definitions
- Production migration completed 2026-03-07, site live with all content
- dev.thehoecks.com is the production site (old Tumblr site still on www.thehoecks.com)
- Tom is the primary admin user

Constraints:
- All changes must work within Vercel free tier limits
- Media uploads must go through presigned R2 URLs (not through Vercel)
- All passwords must be bcrypt hashed, never plaintext
- Post pages must remain publicly accessible (for OG previews)
- Do not break existing auth flow

Do Not:
- Add new services or paid dependencies without explicit approval
- Change the database schema without updating `schema.ts` and ARCHITECTURE.md
- Modify auth middleware behavior without re-verifying all access paths
- Run the migration script against production without Tom's confirmation
- Remove crawler blocking from post pages
- Store plaintext passwords anywhere
- Add features from the V2 backlog during current phases
