# State

## Current Status
Live in production, auto-deployed from `master` via Vercel (project `thehoecks`,
canonical `thehoecks.com`). Tumblr migration completed 2026-03-07. Beyond the
original v1: an installable iOS PWA, daily "On this day" push notifications, a
Settings page, a gold "keepsake" design pass over the chrome, and unguessable
On-This-Day share links are all live. The project is its own repo
(`candystoredev/family-album`) with source at repo-root `src/...`.

**2026-07-09: full app review restructured the roadmap.** See ROADMAP.md.

**2026-07-11: Phases 11, 12, 13 all shipped + 10.3a Indexer built.** Phase 11
(Archive Safety: nightly backups, audit+auth tests, served-photo GPS strip, share
revocation), Phase 12 (metadata correctness: archive/date-display fixes, FTS body,
feed refactor), Phase 13 (debt paydown: HEIC edit fix, dead-code removal, schema
`user_version` guard, security hygiene). **11c (bank originals at upload) deferred
→ 10.3d.** The read-only backfill Indexer (10.3a) is built.

**2026-07-21: shared action sheet, bulk tagging, and place search ALL shipped
(#59, #60, #61 merged + deployed).** The long-press Edit/Share sheet now exists
on every caption surface (feed, On This Day, post page — never public token
pages), single-photo post pages center smartly, and admins can multi-select
feed posts to bulk-apply tags (instantly searchable). **#61 added offline
reverse geocoding** (GeoNames dataset committed, no cloud calls): photo GPS →
`media.place` at upload/edit + `npm run backfill:geocode` for the archive;
`posts_fts` gains `place` + `captions` columns so "Cornwall" finds geotagged
posts; and three new compose-time suggestion sources — temporal-neighbor tags
(±48h), place-derived tags (+ explicit new-tag proposals), and live
title-contains matching (`/api/admin/suggest-tags`, `src/lib/geo/*`,
`src/lib/enrich/temporal.ts`). Suite 155 → 173. **Next action is LOCAL, on
Tom's Mac: `npm run backfill:geocode` (dry-run first) to place-tag existing
photos — until it runs, only new uploads get place labels. `npm run
backfill:local` (from #54) is also still unrun.**

**2026-07-13: date-discrepancy fix + local-first enrichment shipped (#52, #53;
#54 all merged).** Investigating a Fourth-of-July post that displayed the wrong day
surfaced two real bugs (now fixed) and produced a working **10.1e enrichment**
built **local-first** — the sub-stage the older docs call "deferred". Details in
the 2026-07-13 Recent Changes entry below. **Next up: in-browser face clustering
→ People suggestions, then semantic search (10.5).** The Phase 10.3 cross-machine
backfill (Indexer + Tool B) is still parked on source-file gathering, but a
**local OCR + phash backfill** (`npm run backfill:local`) now covers the archive
for tag propagation and date auditing without that blocker.

**2026-07-21: Faces → People built (in-browser face clustering).** The next
enrichment piece after 10.1e — on-device face detection + embeddings, an archive
scan-and-cluster review page, name-a-group-once UX matched against the existing
people list, and compose-time "in this photo" People suggestions. Local, free,
private: no cloud API, CSP-safe same-origin model weights. **Open PR, not yet
merged.** Requires one `POST /api/init` after deploy (schema v3).

## ▶ RESUME HERE (2026-07-21)

**Faces → People is in an open PR** (branch `claude/face-clustering-people-d9a4e0`).
Built, reviewed (dual cold review), 198/198 tests green. Two follow-ups before
heavy use — see "Faces follow-ups" below. Prior context: the local enrichment
stack (**#52, #53, #54**) is all merged + deployed to prod.
The one big remaining Phase 10 piece is now split: the **cross-machine 10.3
backfill**
(Indexer + Tool B, richer Apple Photos/faces data) is still parked on Tom
gathering source photos (`docs/backfill-prep.md`); the **local backfill** (OCR +
phash from stored thumbnails) is built and needs no gathering. Full design:
[`docs/rich-metadata-plan.md`](rich-metadata-plan.md). Status:
[`docs/ROADMAP.md`](ROADMAP.md).

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
- **Phase 10 core** — 10.0 additive schema · 10.1a–d capture at upload · 10.2a–c
  effective-date reads. No prod data mutated (read-time `COALESCE` fallback, so
  historical posts keep their exact prior order).
- **Phase 11** Archive Safety (nightly backups, `npm audit`+auth tests, GPS strip
  on served photos, share-link revocation) · **Phase 12** metadata correctness
  (archive/date-display fixes, FTS body indexing, feed `postAssembly` refactor) ·
  **Phase 13** debt paydown (HEIC edit fix, dead-code removal, `PRAGMA
  user_version` schema guard, security hygiene).
- **10.3a Indexer built** (`tools/backfill-indexer/`) — read-only, phash
  byte-identical to the app; ready to run on Tom's machines.
- **10.1e enrichment (local-first) shipped** (2026-07-13, #52/#53): the date
  bug fixed at the source; compose-time suggestions (date evidence + tags) from
  in-browser OCR + phash + optional cloud vision; a local archive backfill.

**WHERE TO RESUME — updated 2026-07-21.**
1. **Faces → People — BUILT, in an open PR.** See the 2026-07-21 Recent Changes
   entry. **Faces follow-ups before the first big naming pass:**
   - **Un-name / undo (do this first).** A mis-named face permanently pollutes
     that person's reference centroid and there's no in-app fix (only DB
     surgery). This matters most during the *first* naming session, when early
     names define the centroids everything else is matched against. Minimum
     viable: an "Undo" on the just-named cluster + a route that resets
     `person_id`. The `post_people` mis-tag is already reversible via normal
     post editing; the centroid is not.
   - **Post-deploy:** one `POST /api/init` (admin bearer) to stamp
     `user_version = 3` and create `media_faces` on prod. Until it runs, every
     `ensure*Schema()` re-runs its full (idempotent) DDL sweep on each cold
     start — self-healing but wasteful.
   - Lower priority: re-scan has no UI trigger (the auto-face replacement path
     is effectively dead code); deleting a person leaves orphan `source='human'`
     faces with a NULL `person_id`.
   Then **semantic search (10.5)**: in-browser image embeddings + a libSQL vector
   column for natural-language search. Slots into the same enrichment pipeline.
2. **Cross-machine 10.3 backfill (parked on data-gathering).** Tool A (Indexer)
   is built — run it per source on Tom's machines (`docs/backfill-prep.md` +
   `tools/backfill-indexer/README.md`), then build **10.3b Tool B
   (Matcher/Applier)** for the richer Apple-Photos data (real capture dates /
   GPS / on-device faces) + bank originals (10.3d), 10.3c review queue, 10.3e
   promote+index. The local backfill (#54) already covers OCR text + phash for
   old posts, so this track is now purely the *additional* library metadata.
3. **Phase 14 polish (no dependencies, do anytime):** SW caching/offline,
   accessibility pass, On-This-Day → SSR, iOS Shortcut setup guide.

**Mental model for resuming:** the upload path writes the new columns
(`src/lib/media/capture-date.ts`, `extract.ts`, `image-hash.ts` →
`src/app/api/admin/upload/complete/route.ts`); reads consume them via
`src/lib/order.ts` (`ORDER_KEY_SQL`/`EFF_DAY_SQL`). Inspect what got written on
prod with `scripts/capture-check.ts` (needs prod `TURSO_*` env). All additive /
write-only; the legacy `posts.date` is still the immutable source of truth until
a future audited "promote" step.

**Enrichment (10.1e) mental model:** pure logic lives in `src/lib/enrich/*`
(tag matching, date-evidence rules, model output shaping, OCR date parsing) with
no I/O, tested in `tests/enrich.test.ts`. The compose pages run
`useMediaEnrichment` — one ≤1024px rendition per photo fanned out to three
independent, soft-failing sources: local OCR (`ocr.ts`, tesseract.js),
phash tag propagation (`/api/admin/similar-tags`), and **optional** cloud vision
(`/api/admin/enrich`, off without `ANTHROPIC_API_KEY`). Results feed the
suggested-date chip and tag chips; at publish they persist to `media.caption` +
`enrichment_status` and to `media_metadata_raw` (`source='vision'`/`'ocr'`). The
archive backfill (`scripts/backfill-local-enrich.ts`, `npm run backfill:local`)
does the same locally over old media and prints a read-only date-conflict report.

## Active Branch
`claude/face-clustering-people-d9a4e0` — Faces → People, **open PR, not merged**
(rebased onto master after #59–#62). Everything through #62 is merged + deployed.
Normal flow: short-lived branches, squash-merged on Tom's explicit say-so, master
auto-deploys to prod — so merging this PR ships it.

## Current Task
**Run the local backfills on Tom's Mac (no code to write):**
1. `npm run backfill:geocode -- --dry-run` → review → `npm run backfill:geocode`
   — fills `media.place` from stored GPS via the offline dataset, then rebuilds
   FTS transactionally (this rebuild also re-indexes historical bodies, closing
   the old 12c `/api/init` TODO).
2. `npm run backfill:local` (from #54, never run) — local OCR + phash over the
   archive; prints a read-only date-conflict report.
Both need `.env` with `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` (+ R2 vars for
backfill:local). Idempotent, re-runnable, nothing leaves the machine except
DB/R2 reads-writes. Then verify on prod: search "Cornwall".

**Faces → People is now BUILT** (2026-07-21, open PR — see that Recent Changes
entry). Next after it merges: the un-name/undo follow-up, then semantic search
(10.5). All local, free, private (in-browser models), building on the
`useMediaEnrichment` pipeline.

**Cross-machine Phase 10.3 backfill is still PARKED — waiting on Tom, not code.**
Needs source photos gathered across computers/apps for the *richer* Apple-Photos
metadata (real capture dates / GPS / on-device faces). Prep checklist:
**[docs/backfill-prep.md](backfill-prep.md)**. Tool A (Indexer) is DONE; when
sources are mapped, build **10.3b Tool B**. The local backfill (#54) already
covers OCR + phash for old posts, so this track is now the additive library data.

**What remains (see ROADMAP for the full map):**
- **Next (local, no blockers):** faces → People suggestions · 10.5 semantic search.
- **Parked on Tom (data):** 10.3b Matcher · 10.3c review queue · 10.3d originals
  archival (absorbs 11c) · 10.3e promote+index.
- **After backfill:** 10.4 (map, dedup, date-range/place search, trip albums).
- **Available now, no dependencies — Phase 14:** SW caching/offline · a11y pass ·
  On-This-Day → SSR · iOS Shortcut setup guide. (Feed `srcset` and "full-res on
  zoom" are demand-/originals-gated.)
- **Deferred debt (from Phase 13):** CSP nonce (only if a body-editing feature
  lands) · `tokenVersion` enforcement.
- **V2 backlog:** category management, bulk multi-select ops, video thumb-frame
  picker, favorites-heart-in-action-sheet, slide-out redesign, analytics, staging.

**Post-deploy TODO (Tom):** run one `POST /api/init` (admin bearer) to rebuild
FTS so historical bodies erased by prior edits get re-indexed (12c). Then smoke
the feed refactor (12d), GPS strip on a new upload (11d), and share revoke (11e).
After the place-search PR merges: `npm run backfill:geocode` (local, no cloud)
to fill `media.place` for existing GPS photos — until then only new uploads get
place labels. Still pending from #53/#54: set `ANTHROPIC_API_KEY` in Vercel if
cloud vision is wanted, and run `npm run backfill:local` once.
**After the faces PR merges, run `POST /api/init`** — it stamps
`user_version = 3` and creates `media_faces` on prod.

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

### 2026-07-21 session — action sheet everywhere, bulk tagging, place search
- **#59 — Shared post action sheet + smart post-page centering.** Extracted the
  feed's ~250-line long-press/share machinery into `src/components/PostActions.tsx`,
  reused on On This Day (`TodayMemory`) and the post page (`PostContent`). Public
  token pages (`/share/[token]`, `/m/[token]`) provably render no admin
  affordances — `/m` strips internal post ids from its payload. One-shot
  `sheetOpenRef` guard (500ms timer + native contextmenu can both fire),
  capture-phase click suppression so releasing a long-press over an inner link
  doesn't navigate. Single-photo post pages center via flex + `my-auto`
  (`min-h-svh`) — short content centers, tall multisets are untouched.
- **#60 — Bulk tagging.** Admin long-press → "Select posts…" → tap-select across
  infinite scroll (gold ring + check) → bottom bar → tag sheet (same chips +
  autocomplete as the editor) → `POST /api/admin/posts/bulk-tag` (caps 100
  posts/10 tags, find-or-create by slug, `INSERT OR IGNORE` into `post_tags`,
  correct FTS reindex per post in one batch). Tags are searchable immediately.
- **#61 — Part 2: place search + suggestion sources** (merged same day;
  cold-reviewed by a pinned Fable agent, ship-after-fixes verdict, all fixes
  applied — the FTS migration/rebuild paths are single transactional batches).
  - **Offline reverse geocoding**: `scripts/build-geo-dataset.ts` trims GeoNames
    (CC-BY 4.0, attribution in ARCHITECTURE.md) to
    `src/lib/geo/data/places.json.gz` (69,512 places, 1.14 MB);
    `reverseGeocode(lat,lng)` (`src/lib/geo/reverse.ts`) does haversine
    nearest-neighbor with a lat-band prefilter, 50 km cap. Upload + edit routes
    write `media.place` (soft-fail); `scripts/backfill-geocode.ts` fills the
    archive locally then rebuilds FTS. `next.config.ts`
    `outputFileTracingIncludes` bundles the dataset into the geocoding routes.
  - **Search**: `posts_fts` now indexes `place` + `captions` (7-column shape);
    `ensureSearchSchema()` migrates lazily (probe → drop → recreate → rebuild
    from source tables, body always from `posts.body`); `SCHEMA_VERSION` 1→2 so
    deployed DBs self-heal on first write. All write sites emit the new shape.
  - **Compose suggestions** (`/api/admin/suggest-tags`): temporal neighbors
    (±48h vs the `ORDER_KEY_SQL` COALESCE, frequency-ranked), place components
    matched to the tag vocabulary (unmatched town/county become explicit `isNew`
    proposals; region/country match-only), and `suggestTagsFromTitle` (whole-word,
    client-side, live as you type). All suggest-only, closed vocabulary; wired
    as a 4th soft-failing source in `useMediaEnrichment` with request dedup.

### 2026-07-21 session — Faces → People (in-browser face clustering)
The next enrichment piece after 10.1e, built local-first on the same pattern.
**Open PR on `claude/face-clustering-people-d9a4e0`, not merged.** Rebased onto
master after #59–#62. Suite 173 → 198.

- **Shared core (`src/lib/faces/`).** `detect.ts` lazy-loads
  `@vladmandic/face-api` on the tfjs **WebGL** backend (never WASM — the app's
  CSP has no `'wasm-unsafe-eval'`), with weights served **same-origin** from
  `/models`. `cluster.ts` is pure, tested logic: single-link connected-component
  clustering + `matchToKnown` against per-person reference centroids.
  `descriptor.ts` packs the 128-d embedding into a 512-byte Float32 BLOB.
- **Schema (additive).** `media_faces` (box, descriptor BLOB, nullable
  `person_id`, `source`) + `media.faces_scanned_at`, via `ensureFacesSchema()`
  following the `day_share_links` lazy-ensure pattern. **`SCHEMA_VERSION` bumped
  2 → 3** — required, or the at-v2 prod DB (stamped by #61's FTS migration) would
  fast-path straight past the new DDL and never create the table.
  `initializeSchema()` creates the faces objects *before* stamping.
- **Surface A — cluster-and-name** (`/admin/people/faces`, linked from Settings →
  Admin). Scans the archive in-browser (thumbnails proxied same-origin so the
  canvas isn't CORS-tainted), banks faces unnamed, server-clusters the backlog,
  pre-fills "looks like @X", and names a whole group in one action → assigns the
  person + tags them on the affected posts (`source='auto'`) + rebuilds FTS.
- **Surface B — compose-time.** `useMediaEnrichment` gains a 4th soft-failing
  source: detected faces → `/api/admin/faces/match` → "in this photo" tap-to-add
  People chips. **Gated on `referenceCount > 0`** so the ~7 MB model never loads
  until someone has been named. Writes nothing — see below.
- **Publish path untouched.** `upload/complete` and the edit `PUT` are
  byte-identical to master; the scanner owns all face persistence (it picks up
  new uploads via `faces_scanned_at IS NULL`). Deliberate: zero regression risk
  on the app's most load-bearing path.
- **Model weights are NOT committed** — `scripts/copy-face-models.mjs` stages
  them from node_modules via `prebuild`/`predev`; `/public/models/` is
  gitignored. Avoids 6.7 MB in git history forever.
- **Dual cold review (opus + fable, both pinned).** Confirmed all 8 invariants
  (migration safety, publish integrity, CSP/privacy, BLOB round-trip, admin
  gating, SQL, suggest-never-auto-apply). Fixed from findings: the naming route
  now derives every write from the still-unnamed subset (a stale/duplicate name
  was able to tag posts and mint a person owning zero faces); the scan loop
  checks its POST response (could loop forever or falsely report "complete");
  failed thumbnail fetches stay queued instead of being marked scanned-with-no-
  faces; the review page shows **every** face in a cluster, not a 4-crop sample;
  `personId` is sent when known (slug-collision merges); `Number.isFinite`
  descriptor guards; per-image detection errors no longer disable the session.
- **New tests.** `tests/faces.test.ts` (pure clustering/matching/BLOB) +
  `tests/faces-routes.test.ts` (10 DB-level route tests against a throwaway
  local libSQL file — the first DB-touching test harness in the repo).

### 2026-07-13 session — date-discrepancy fix + local-first enrichment (10.1e)
Triggered by a real report: a "Happy 250th America!" post displayed **Jul 6**
though the party was **Jul 4**. Root-causing it uncovered two bugs; fixing it
well produced the enrichment sub-stage the docs had deferred. Suite 138 → 155.

- **#52 — Suggested-date preview + working manual dates.** Two bugs:
  1. The upload client auto-sent the *first* file's client-extracted EXIF date as
     the post `date`, which the server records as `date_source='manual'` (high
     trust, no "est." badge) — silently overriding the earliest-capture rollup
     with one arbitrary file's date. The likely mechanism behind the Jul 6 post.
     The client now sends a date only when the user typed one; legacy `posts.date`
     falls back to the rollup instant.
  2. Editing a post's date updated only legacy `posts.date`, which the Phase 10.2
     reads *ignore* whenever `taken_at`/`local_date` exist (every post since 10.1)
     — so date corrections silently did nothing. `PUT /api/admin/posts/[postId]`
     now resolves the new date as a manual capture and updates
     `taken_at`/`local_date`/`date_source` together. Also: media added on the
     **edit** page was inserted with NO capture/identity/EXIF columns (metadata
     lost) — now runs the same original-file extraction as upload, full parity.
  Plus a live **"Suggested date"** hint on the compose form (earliest capture,
  the exact server rule) and a shared `earliestCapture()`.
- **#53 — Compose-time enrichment, local-first.** One ≤1024px rendition per
  photo, fanned out to three independent soft-failing sources while the form is
  open: **(a)** in-browser OCR (tesseract.js) → written-date evidence chip
  ("photo shows 'JULY 4, 2026' — Use it"); **(b)** phash tag propagation
  (`/api/admin/similar-tags`, Hamming ≤6/64) → tags from visually-identical
  already-tagged photos, no ML; **(c)** optional cloud vision
  (`/api/admin/enrich`, Claude, `claude-haiku-4-5` default) → captions/labels for
  search + closed-vocabulary tag matching, **off entirely without
  `ANTHROPIC_API_KEY`**. Suggest-don't-auto-apply throughout; dates never
  auto-applied; only literal quoted evidence counts (decorative "1776" rejected).
  Persists to `media.caption` + `enrichment_status` + `media_metadata_raw`
  (`source='vision'`/`'ocr'`). Pure logic in `src/lib/enrich/*`, tested.
- **#54 (merged) — Local archive backfill.** `scripts/backfill-local-enrich.ts`
  (`npm run backfill:local`): fills missing phash (from stored thumbnails, so
  `/api/admin/similar-tags` matches historical posts) + OCRs every image + prints
  a **read-only date-conflict report** (posts whose photo text disagrees with the
  shown date — reproduces the Jul 4 bug on the seeded fixture). Re-runnable,
  `--dry-run`/`--limit`/`--phash-only`/`--report`. Mutates no post dates.
- **Deferred vs shipped:** the older "10.1e = Railway worker, ML backends stubbed"
  framing is superseded. 10.1e is delivered as **compose-time, browser-driven**
  enrichment (no worker/cron); the async-queue variant is unnecessary at this
  scale. Faces + semantic search (10.5) are the remaining enrichment pieces.
- **New env (both optional):** `ANTHROPIC_API_KEY` (enables the cloud source;
  sends thumbnails to the Claude API — 30-day retention, not used for training),
  `ENRICH_MODEL`. Without them, OCR + phash still work fully.

### 2026-07-11 session — Phase 13 (debt paydown) shipped + 10.3a Indexer built
All merged to `master`. Suite 135 → 135 (app tests unaffected by the Indexer,
which is additive under `tools/`).
- **13a (#46):** edit page adopts the shared `compressImage` (fixes HEIC editing —
  its private copy had no HEIC support) + shared `MetadataFields`. −167 lines.
- **13d (#47):** `slugify` deduped → `src/lib/slugify.ts`; client-supplied
  `r2Key`/`keyPrefix` validated (`startsWith("media/")`, no `..`) in both write
  routes before any R2 op; `String(error)` echoes removed (init/test/share/day);
  push-subscribe host allow-list (Apple/Firefox/FCM/Edge); inert JWT
  `tokenVersion` claim (forward-prep, not enforced).
- **13b (#48):** dead `invite_links` dropped; `SeedButton`/`/api/seed` removed (seed
  logic → `scripts/seed.ts`); stale `@types/sharp` dropped; **`PRAGMA user_version`
  guard** skips the ~50 cold-start `ALTER` sweeps once `/api/init` stamps
  `SCHEMA_VERSION=1` (safe: init creates every `ensure*`-managed object first).
- **10.3a Indexer (#49):** `tools/backfill-indexer/` (Python). Read-only; phash
  **byte-identical to the app** (pyvips = same libvips; verified vs the real TS
  `perceptualHash` via a `tsx` oracle). Filesystem adapter done + tested;
  apple_photos/google_takeout/xmp scaffolded (need real libraries). Runs on Tom's
  machines when sources are mapped.
- **Deferred (not built):** CSP nonce / drop `'unsafe-inline'` (only matters once a
  body-editing feature lands — `posts.body` is never user-writable today);
  `tokenVersion` enforcement.

### 2026-07-11 session — Phase 12 (metadata correctness) shipped
All merged to `master`. Suite 116 → 135.
- **12a/12b (#42):** archive page groups by `EFF_DAY_SQL` (matches `/api/archive`)
  + `/archive/[year]/[month]` prev/next nav fixed; post-date display routed
  through `formatDisplayDate` at `share/[token]`/`OnThisDay`/`TodayMemory`
  (`OnThisDayPost.localDate` added); tz-safe day-label sites left alone.
- **12c (#41):** incremental FTS writes index the real body via `ftsRowFor()`.
  Root cause was worse than framed — the edit route erased existing captions from
  the index on every edit. **Post-deploy: one `POST /api/init` rebuild** backfills
  historical bodies.
- **12d (#43):** feed enrichment unified into `src/lib/postAssembly.ts` (4 read
  paths); `/api/feed` parallelized. Behavior-preserving — `feed-order` +
  `cursor-pagination` tests unchanged; reviewed line-by-line. Two drifts:
  `display_order` unified (inert), video-thumbnail fallback preserved per-caller
  via a `videoThumbnailFallback` option (future standardization candidate).
- **Merge order:** #41 → #43 → #42 (#42 reconciled against #43's `onThisDay.ts`
  refactor; auto-merge verified: 135/135 tests, clean build).

### 2026-07-11 session — Phase 11 (Archive Safety) shipped
All merged to `master` and (where verifiable) confirmed. Test suite 69 → 116.
- **11a Backups (#35, #36):** daily GitHub Actions cron dumps Turso via the
  turso CLI's native `.dump` → gzip → private `thehoecks-backups` R2 bucket →
  prune to 30. `scripts/restore-drill.ts` (`npm run restore-drill`, `--self-test`).
  First real run failed (turso `.dump` needs an `https://` URL, not `libsql://`);
  fixed in #36 and re-run **green end-to-end**. Tom created the private bucket +
  6 GitHub secrets.
- **11b Hardening (#37):** `npm audit fix` 6 vulns→3 (0 high; Next.js
  middleware-bypass CVEs + `ws` gone; residual 3 upstream-unfixed/dev-only).
  `tests/auth-middleware.test.ts` — 40 tests driving the real `middleware()`.
- **11d Serve clean (#38):** removed the `alreadyProcessed` fast path that served
  raw EXIF/GPS bytes; every served photo now re-encodes via
  `src/lib/media/process-photo.ts` (strips EXIF). 50 MB upload cap
  (`MAX_UPLOAD_BYTES`) server-enforced + client pre-check. **Videos not stripped**
  (no server ffmpeg — documented limitation). `tests/process-photo.test.ts`.
- **11e Share revocation (#39):** `revoked` on `post_share_links` +
  `day_share_links` (lazy-ensured); `/share/[token]` + `/m/[token]` reject revoked
  via `src/lib/shareLinks.ts` `isShareLinkUsable()`; admin `GET/POST
  /api/admin/share-links` + Settings UI section. No expiry change.
- **11c DEFERRED → 10.3d:** banking full-res originals at upload would add a
  private third copy per photo; deferred because originals still live in the
  family's photo library (10.3 Indexer walks it). 10.3d now archives originals
  (historical + going-forward) to the private bucket's `originals/` prefix. See
  DECISIONS 2026-07-11.
- **Not verified in-sandbox (need prod R2 / a running app):** 11d served-photo
  GPS strip on a real geotagged upload + the >50 MB 413; 11e revoke→404 flow.
  Manual checklists in PRs #38/#39. All unit tests + builds pass locally.

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
