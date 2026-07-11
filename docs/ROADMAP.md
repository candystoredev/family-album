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

### Hotfix — iOS Safari single-photo row collapse (2026-06-10) — ~~DONE~~ ✓
- `h-full` in an auto-height flex chain resolves to 0 on Safari (no intrinsic-size fallback)
- Single-photo rows in multi-photo posts (e.g. layout "31") were invisible on iPhone
- Fix: single-photo rows use `h-auto` + stored `width/height` as `aspect-ratio`; multi-photo rows keep `h-full` + `aspect-ratio: 4/3`

### Shipped post-launch (2026-06) — **DONE** ✓
Beyond the original v1 plan; all live in production. Details in DECISIONS.md / ARCHITECTURE.md.
- **Standalone repo + go-live** — extracted to `candystoredev/family-album` (source at root `src/...`); `master` auto-deploys to production (`thehoecks.com`).
- **Installable iOS PWA** — manifest + service worker, gold monogram icon, standalone mode, auto-refresh on re-foreground.
- **Daily "On this day" push notifications** — Web Push/VAPID, `push_subscriptions`, `/api/notifications/*`, daily cron (GitHub Actions → `/api/notifications/daily`), admin send-hour/timezone.
- **Settings page** (`/settings`) — per-device notification toggle + admin controls (notifications, site title/description/banner, iMessage recipients, change family password, timeline layout). *(satisfies much of the Phase 5 "Admin Panel & Settings" scope below.)*
- **`/today` "On This Day" page** + nav link; up to 6 memories (≤2/year), teaser/notification stay at 3.
- **On This Day share links** — unguessable `/m/[token]` (public, iMessage preview) + `day_share_links` + `POST /api/share/day`.
- **Gold "keepsake" design pass** (chrome only) — Source Serif 4, gold accent, paper grain; nav/settings/upload redesigned; symmetric heart + clean gear icons.
- **Navigation redesign** — serif monogram, compact rows, Albums expand-in-place, classic + **rail** timeline layouts (shared `useTimelineStyle` pref), packed FAB cluster.
- **Video capture dates** — MP4/MOV container parsing (mvhd + Apple `creationdate` w/ tz offset), full-timestamp ordering; `tests/video-date.test.ts`.

### Next initiative — Phase 11 → 12 → 10.3 (see below)
Archive Safety (backups + hardening) → metadata-correctness completion → the Phase 10
historical backfill. Phase 10 (Rich Media Metadata & Enrichment) stays the spine —
full design in `docs/rich-metadata-plan.md`.

## Up Next

### Retired phases (2026-07-09 review)
The app review found the old "Up Next" (Phases 5–8) had rotted — much had shipped via
other routes, some described APIs that never existed. Disposition:
- **Phase 5 — Admin Panel & Settings** — 5a/5b/5c shipped; `/settings` satisfied 5d's settings scope; invite-link management **CUT** (dead `invite_links` table never implemented — shared password + share links cover the use cases; table dropped in Phase 13); **5d-flag** (post flagging & review queue) absorbed into **Phase 10.3c**; 5e/5f/5g (tech-stack page, changelog, admin tabs) **CUT** — the docs already do this job.
- **Phase 6 — iOS Shortcut** — rewritten as-built: the documented `POST /api/posts` never existed; the real flow is presign → direct R2 PUT → `/api/admin/upload/complete`, plus the shipped share-to-upload route `/api/admin/upload/ingest-fetch` (opens `/admin/upload?ingest=…`). Remaining work (a committed Shortcut definition + setup guide) moves to **Phase 14** as optional.
- **Phase 7 — Performance & Polish** — absorbed into **Phases 12 and 14**.
- **Phase 8 — Go Live** — ~~DONE~~ ✓ (site live at thehoecks.com, `master` auto-deploys).

### Phase 9 — Bulk Import — **IN PROGRESS**

Desktop and tablet only (mobile shows a friendly fallback card linking to `/admin/upload`). A catch-up import tool for adding large batches of photos at once — the primary use case is uploading historical photos that predate the Tumblr era or weren't captured in the migration.

#### Concept
Select many images at once → client reads EXIF dates → app auto-groups them into suggested posts based on timestamp proximity → admin reviews and adjusts groups (merge/split buttons first, drag-and-drop as polish) → fills in metadata per group → publishes all as separate posts in one action.

#### Sub-phase ordering
9-pre through 9c form a complete, usable tool (mis-groupings fixable via merge/split). 9d (cross-group drag) and 9e (zoom) are polish. Resequenced from the original plan so the end-to-end path ships first.

#### Sub-phases

- **9-pre — Shared extraction** ~~DONE~~ ✓
  - `src/lib/media/compress.ts` — `compressImage` extracted from upload page
  - `src/lib/media/exif.ts` — `getMediaDate(file)` with fallback chain: EXIF → filename pattern → `file.lastModified`. `dateFromFilename` handles `IMG_20190704`, `2019-07-04`, `20190704` etc.
  - `src/lib/media/layout.ts` — unified `defaultLayout`/`generatePhotosetLayout`, previously duplicated between upload page and complete route
  - `src/components/MetadataFields.tsx` — `useMetadataOptions()` hook + shared fields component (title, date, tags, people, albums)
  - **Bug fixed**: large photos (>1920px) silently got today's date instead of EXIF date — canvas re-encode strips EXIF; single upload now reads date client-side and passes it explicitly
  - Tests: `tests/media-lib.test.ts` (layout + EXIF), `tests/grouping.test.ts` (gap grouping)

- **9a — Ingest + auto-grouping + merge/split** ~~DONE~~ ✓
  - `/admin/bulk-import` page; "Bulk Import" link added to `ArchiveMenu` (desktop only)
  - Two-pass ingest: EXIF pass (8-concurrent, groups render immediately) then thumbnail pass (4-concurrent, ≤320px `createImageBitmap` blobs, progressive)
  - Memory: originals never rendered as object URLs; `content-visibility: auto` + `containIntrinsicSize` on cards
  - `groupByGap(items, thresholdMs)` pure function in `src/lib/media/grouping.ts`
  - Segmented threshold control (1 hr / 6 hrs / 1 day); locks after first manual edit
  - Merge-into-previous button; split-here affordance (hover between photos to reveal ✂)
  - Date-source badge for filename/mtime fallback dates
  - `beforeunload` guard while unpublished work exists
  - Mobile fallback card

- **9b — Per-group metadata editing** ~~DONE~~ ✓
  - Inline `MetadataFields` per card: title, date (pre-filled from EXIF), tags, people, albums
  - "Apply tags/people/albums to all" buttons — appear when a group has selections
  - Skip toggle per card; skipped count shown in toolbar; fields/controls lock when skipped
  - `items-start` on grid so cards don't stretch to the tallest sibling

- **9c — Batch publish** ~~DONE~~ ✓
  - "Publish N posts" button (excludes skipped and already-published groups)
  - Per group: `compressImage` → presign → PUT to R2 → `/api/admin/upload/complete`; 2 groups in parallel, photos within a group upload in parallel
  - Date always passed explicitly (compression strips EXIF, server cannot recover it)
  - Per-card state: "uploading…" label → green "published" badge + ring → red error + Retry
  - Toolbar live count (`Publishing… (3/8)`) → "X published — view feed" link when all done
  - Metadata fields/controls lock while uploading or published; Clear all resets publish state

- **9d — Drag-and-drop: row layout + cross-group + new group** ~~DONE~~ ✓
  - Full row-layout control within a group (ported the upload page's interaction): drag a photo to the top/bottom of a row (new-row zone) to restructure into 1+3, 1+2+1, etc.; drag into a row's middle to reorder. Group model is now `itemIds` + `layout` (row sizes); published posts send the manual `photosetLayout`.
  - Cross-group: drag a photo onto another card to move it there.
  - New group: a dashed "drop here to start a new post" tile appears during a drag; dropping a photo there extracts it into its own group (no-op for solo photos so metadata isn't lost).
  - Implementation: `@dnd-kit` `useDraggable` + a global `pointermove` hit-test across all groups/rows + the new-group zone (synchronous, not rAF — works even when the tab is backgrounded), with a pure `computeDisplay` for live preview and commit. Replaced the initial `SortableContext` approach.
  - Removing the last photo from a group deletes the group; locked groups (skipped / uploading / published) reject drags.

- **9e — Zoom / posts-per-row (polish)** ~~DONE~~ ✓
  - The grid is `repeat(auto-fill, minmax(min(cardMin, 100%), 1fr))` — it now fills the full screen width (an ultrawide shows many posts per row instead of being capped at 3)
  - Toolbar zoom control: −/slider/+ adjusts `cardMin` (smaller cards = more per row), persisted in `localStorage`
  - Trackpad/Ctrl-wheel pinch zoom, scoped to the grid via a non-passive `wheel` listener (suppresses browser zoom)
  - Container queries for collapsing metadata at small card widths: deferred (not needed yet — the form stays usable down to ~170px)

- **9d.1 — Drag feel polish (match the upload page)** ~~DONE~~ ✓
  - The dragged photo previews as a blue insertion line — horizontal for a new row, vertical for within-row — while the real photo rides the `DragOverlay` (exactly the upload page's behavior). The thin line means almost no reflow, killing the old jumpiness.
  - Drop target debounced 80ms so hovering near a zone boundary doesn't oscillate.

- **9c.1 — Per-card publish** ~~DONE~~ ✓
  - Each card has its own Publish button: post one group when it's ready, without touching the rest. On success the card shows "Published ✓" for a beat, then clears itself (thumbs revoked, items freed) — workspace empties as you go. Errors keep the card with a Retry.
  - Publish-all progress uses a stable denominator (done + remaining) since finished cards remove themselves.

- **9d.3 — Drag a photo out to a new post (green between-cards line)** ~~DONE~~ ✓
  - Dragging a photo *out* of its card (into the gap/space between or beside cards) now creates a new post at that position. A **green line between the cards** shows where the new post will land — the counterpart to the blue line that restructures rows *inside* a post.
  - Dropping over another card still adds the photo to that post (blue line). Dropping a group's only photo onto a new-post target is a no-op (keeps its metadata).
  - Replaced the single dashed "start a new post" tile (append-only, easy to miss) with positional green-line insertion anywhere between cards.

- **9d.2 — Drag targeting + lone-photo fill + sidebar** ~~DONE~~ ✓
  - "New top row" is now a large, reliable target: the whole header band above row 0 (plus the top ~45% of it) maps to a new top row, so you don't slip into the card above. Same generous treatment for the bottom row and between-row gaps. The same "above the first row → new top row" fix was applied to the upload page.
  - A lone photo in a row now fills the full card width (taller for portraits) instead of deriving a narrow width from its height — gives confidence the post will render right.
  - The slide-out sidebar is hidden on `/admin/bulk-import` (it was overlapping the cards); a small ← back link in the toolbar replaces it. (Upload page already hid it.)

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

### Phase 10 — Rich Media Metadata & Enrichment

Full design: **[docs/rich-metadata-plan.md](rich-metadata-plan.md)**. Goal: give every
photo/video durable, richer data so sorting/grouping stay correct and future
features (map, dedup, semantic search, faces) stay open. Bias: capture more than
we model, never overwrite, record provenance, keep everything re-runnable.

**Why:** dates collapse to one timezone-less `posts.date` read three ways
(order lexicographic, group via `strftime`=UTC, display via `new Date`=local).
Edge cases: photo EXIF interpreted differently client (browser-local→UTC) vs
server (UTC) → same photo can shift day; photos vs videos diverge; no-metadata
media falls to upload time; random `id` tiebreaker; per-media dates discarded.

**Data model (additive/nullable):** on `media` — `taken_at` (UTC) + `tz_offset`
+ `local_date` + `date_source`/`date_confidence`; GPS + `place`; camera make/
model/lens; `duration`/`fps`/`codec`/`is_live`/`is_screenshot`/`dominant_color`/
`aspect`; `content_hash` + `phash` + `original_filename`; `caption` + `embedding`
+ `quality_score` + `enrichment_status`/`version`/`enriched_at`. New tables
`media_metadata_raw` (full payload JSON) and `media_sources` (origin refs:
apple_photos/dropbox/icloud/google/filesystem/upload + ids + match confidence).
Auto vs human `source` on tags/people so regeneration never clobbers curation.
`posts` rollup: `taken_at`, `local_date`, `date_source`, `source`.

**Progress (as of 2026-06-26): 10.0, 10.1a–d, and 10.2a–c are DONE — shipped &
verified on prod.** The correctness core of Phase 10 is complete. Remaining:
10.1e (deferred), then the optional/separate tracks 10.3 / 10.4 / 10.5.

**Sub-phases:**
- **10.0 Schema** — add columns + `media_metadata_raw` + `media_sources`. No behavior change. ✅ **DONE**
- **10.1 Capture + real-time enrichment (live uploads)** — synchronous extraction
  from the original before compression; server fallback uses the *same* rule as
  the client. Shipped in write-only stages:
  - **10.1a** date capture (shared `resolveCaptureDate`; EXIF incl. `OffsetTimeOriginal`, video offset) ✅ **DONE**
  - **10.1d** HEIC compression fix on non-Safari (`heic2any`) ✅ **DONE**
  - **10.1b** identity/visual (`content_hash` + `phash` + `dominant_color` + `aspect`/`orientation` + `original_filename`) ✅ **DONE**
  - **10.1c** GPS + camera/device + raw EXIF → `media_metadata_raw` + `media_sources` ✅ **DONE** *(video container deep-parse — GPS/fps/codec/duration — deferred)*
  - **10.1e** async enrichment queue + Railway worker/cron (faces/scene/caption/embedding/score), pluggable + versioned + idempotent — ⏸ **DEFERRED** (ML backends are stubs until 10.5, so nothing to process yet; build it alongside 10.5)
- **10.2 Flip reads + estimated-date UX** — ✅ **DONE** via read-time `COALESCE`
  (`lib/order.ts`, no prod data mutated): **10.2a** feed ordering + cursor by
  effective `taken_at`; **10.2b** archive + on-this-day grouping by effective
  `local_date`; **10.2c** corrected-date display + "est." badge. *(Tiebreaker is
  `(order_key, id)`; the plan's `created_at` middle key was skipped to keep the
  2-tuple cursor — revisit only if exact-instant ties become an issue.)*
- **10.3 Historical backfill (separate track; runs on a machine without Claude)** —
  Tool A + Tool B, both writing to new columns only. Adapters: Apple Photos via
  `osxphotos` (faces, scene labels, keywords, albums, captions, favorites, quality
  scores — on device), filesystem (Dropbox/iCloud Drive), Google Takeout JSON, XMP
  sidecars. Surfaces un-uploaded originals as an optional "rediscover" queue. Sub-phases:
  - **10.3a Tool A — Indexer** — osxphotos/filesystem/Takeout/XMP adapters, portable index file, read-only, idempotent, resumable.
  - **10.3b Tool B — Matcher/Applier** — phash match to stored thumbnails, confidence thresholds, applies to new columns only via an authed admin endpoint.
  - **10.3c Review queue** — one `/admin/review` surface with three queues: ambiguous backfill matches + flagged posts (absorbs old 5d-flag) + estimated-date quick-fix (absorbs 10.2c's loose end).
  - **10.3d Originals archival option in Tool B** — matched local originals → `originals/` prefix (closes the historical half of 11c; Tumblr-era photos regain a full-res source).
  - **10.3e Promote + index** — the audited promote step: with coverage high, order/group by real indexed columns and retire the read-time `COALESCE` hot path (fallback kept for stragglers). Perf note: interim expression indexes were considered and rejected — SQLite can't ALTER-ADD stored generated columns and the scan is milliseconds at current scale.
- **10.4 Features on banked data (optional)** — map view, dedup warnings,
  auto-trip albums, place/camera/date-range search, quality-ranked teasers.
  (Absorbs backlog: Search by date range, Filter by multiple tags/people,
  Related posts, Download original.)
- **10.5 Semantic enrichment (optional, pluggable)** — captions + open-vocabulary
  tags + per-photo embeddings for semantic search; local CLIP (private) or vision
  LLM (richer); libSQL vector column; feeds FTS + semantic search.

**Privacy:** family photos incl. children — default on-device (Apple Photos for
backfill, local/server model for live) for faces + scenes; cloud vision / LLM
captioning is opt-in. **Never expose precise GPS on public `/m/` share pages or a
future map** — strip/round before anything public.

**Build order:** 10.0 + 10.1 first (low risk, banks data everything else needs),
then 10.2. Backfill (10.3) and semantic enrichment (10.5) are separate opt-in tracks.

**Verify (per sub-phase):**
- 10.0: migrations apply on prod Turso; existing reads unaffected.
- 10.1: new upload populates taken_at/local_date/gps/device/hashes; enrichment
  queue drains; HEIC upload works on Chrome/Firefox.
- 10.2: a late-night photo groups to the correct local day; same-instant posts
  keep stable order; estimated-date badge shows for no-metadata media.
- 10.3: a re-encoded album thumbnail matches its original by phash; metadata
  applies to new columns without duplicating posts; ambiguous matches queued.

---

### Phase 11 — Archive Safety — **NEXT UP**
Small; protects everything else.

- **11a Backups** — ~~GitHub Actions cron → `turso db dump` → private R2 prefix (e.g. `backups/`), keep last ~30 daily dumps; document one manual restore drill in ARCHITECTURE.~~ — **DONE** (`.github/workflows/backup.yml` + `npm run restore-drill`; see ARCHITECTURE "Backup Strategy"). **User setup still required**: create the private `thehoecks-backups` R2 bucket and add the GitHub Actions secrets (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BACKUP_BUCKET`) before the workflow can run.
  - Verify: dump lands in R2 on schedule; app boots locally against a restored scratch DB.
- **11b Dependency + auth hardening** — `npm audit fix` (Next.js middleware-bypass CVEs matter — all auth is middleware-enforced); add the long-promised auth-middleware tests (viewer/admin/public-path matrix).
  - Verify: audit clean; tests cover every public path.
- **11c Bank originals going forward** — upload flows presign a second key and PUT the untouched file to an `originals/` prefix (never served; `original_r2_key` on `media`). Rationale: client compression (1920px JPEG) currently discards full-res originals forever; the original file is the ultimate metadata record; R2 cost trivial.
- **11d Serve clean, keep raw** — with 11c, the upload-complete "already-processed" fast path (iOS-shortcut/originals path) can re-encode its *served* copy, stripping GPS/EXIF like the edit route already does, with zero information loss. Plus an upload size cap on presign/complete.
  - Verify: served original of a geotagged upload has no GPS tags; oversized presign rejected.
- **11e Share-link revocation** — `revoked` flag on both `post_share_links` and `day_share_links` + small admin list/revoke UI. NO auto-expiry — links stay persistent by design (old iMessage links must keep working; upholds the 2026-06 decision).
  - Verify: revoked `/m/` link 404s; others unaffected.

---

### Phase 12 — Metadata correctness completion
Small; finishes what 10.2 claims.

- **12a Archive page → effective day** — `/archive` page still groups by legacy `strftime(date)` while the archive API uses `EFF_DAY_SQL` — reconcile to one source (the API's). Becomes user-visible after the 10.3 backfill.
- **12b All date display through `formatDisplayDate`** — ~6 raw `new Date(post.date)` call sites (/today, /m/[token], /share/[token], OnThisDay, TodayMemory, bulk-import) bypass the tz-safe helper — exactly the day-shift class Phase 10 exists to kill.
- **12c FTS body indexing** — incremental FTS writes insert `body=''`, so body text is only searchable after a full rebuild. Index body on create/edit + one rebuild.
- **12d Feed pipeline** — `/api/feed` runs its three enrichment queries sequentially (the SSR path already uses `Promise.all`) — parallelize; extract the one shared "attach media/tags/people" function (currently ~5 near-identical copies across `lib/feed.ts`, `api/feed`, `api/search`, `lib/onThisDay` — already drifted on `display_order`).
- Verify: a late-night photo lands on the same day in feed, archive page, archive API, and /today; body text of a fresh post is searchable; feed scroll round-trips reduced.

---

### Phase 13 — Debt paydown
Opportunistic, no deadline.

- Edit page adopts shared `compressImage` (fixes a real bug: the edit page's private copy has no HEIC support) + shared `MetadataFields` (currently hand-rolls its own form). Do **NOT** unify the three drag-and-drop implementations — documented deliberate divergences.
- Delete dead `invite_links` table; remove SeedButton from prod UI and move `/api/seed`'s seed/dedup/clean logic to `scripts/` (552 lines of test tooling in the prod bundle; button always 403s in prod).
- Drop stale `@types/sharp` devDep; dedupe `slugify` (defined in both create and edit routes); collapse the three `ensure*Schema` functions into one `PRAGMA user_version` check (currently ~50 sequential guarded DDL statements on first upload per cold start, and schema DDL duplicated with `initializeSchema`).
- Security hygiene leftovers: stop echoing `String(error)` to clients (7 sites, 5 authed routes); push-subscribe endpoint allow-list (weak blind-SSRF, session-gated); add JWT `tokenVersion` claim now / enforce later; CSP nonce only if a body-editing feature ever lands (today `posts.body` is never user-writable, so the 4 `dangerouslySetInnerHTML` sites are latent); validate `r2Key`/`keyPrefix` in upload-complete + posts PUT (copy the guard `ingest-fetch` already has).

---

### Phase 14 — Experience
On-demand, never blocking.

- Feed `srcset` **only** if cellular scroll actually annoys — the lightbox always serves the original; feed keeps full-size images by default (2026-07-09 decision: R2 egress is free and the family values pinch-zoom detail).
- "Full-res on zoom" in lightbox once originals are banked (11c/10.3d).
- Service-worker app-shell + thumbnail caching (real PWA offline; `sw.js` currently caches nothing).
- Accessibility pass: alt text from title/date, keyboard-operable feed (every `img` is `alt=""` today; feed photos aren't focusable; Lightbox keyboard nav is already good).
- On This Day folded into SSR (currently a client-side fetch waterfall + full scan on every home load).
- iOS Shortcut definition + setup guide (from retired Phase 6), documented around the real endpoints.

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
- ~~Favorites / pinned posts~~ ✓ **SHIPPED** — `/favorites` page + `/api/favorites` in prod
- Download original photo button
- Print-friendly view

### UX & Delight
- **Favorites heart in action sheet** — heart button in the long-press sheet (all users); joyful fill animation on tap; persisted per-user. Replaces or extends the double-tap heart from 4i.
- **Slide-out menu redesign** — current panel is functional but visually rough. Redesign to match the feed's dark aesthetic and typography more closely. Goal: joyful, easy to navigate, aesthetically consistent. Consider Claude Design for the visual pass.

### Search & Discovery
- Search by date range _(→ Phase 10.4)_
- Filter by multiple tags/people simultaneously _(→ Phase 10.4)_
- "Related posts" suggestions _(→ Phase 10.5, via embeddings)_

### Media
- Video thumbnail frame picker (v1: auto poster frame)
- Multiple thumbnail sizes (feed vs. lightbox vs. OG) — R2 key convention supports this (`media/{id}/thumb_lg.{ext}`, etc.)

### Analytics (Lightweight)
- Most-viewed posts (simple counter, no third-party tracking)
- Share-link usage stats (invite links cut 2026-07-09)

### Infrastructure
- Staging environment

## Testing Strategy

**Status (2026-07-09):** 69 tests pass across 11 files — mostly Phase 9/10 coverage
(EXIF, grouping, hashing, feed-order, dates, cursor pagination). The originally
promised slug-generation and FTS5-search tests are still missing — add opportunistically.

**Automated tests** (written as they come up):
- Slug generation (duplicates, untitled fallbacks, suffix logic) — *still missing*
- Cursor-based pagination (ordering, tiebreakers, no skips/dupes) ✓
- Auth middleware (viewer/admin/public-path matrix) — *now scheduled in Phase 11b*
- FTS5 search (insert posts, verify results match) — *still missing*

**Manual verification**: Against thehoecks.com (production) on desktop and phone.

Each phase has a verify checklist — phase isn't done until every item passes.
