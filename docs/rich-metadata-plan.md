# Rich Media Metadata — Plan

A living design doc for giving every photo/video richer, more durable data so
sorting, grouping, identification, and search stay correct today and stay open
to future features. Safe to carry to other machines (e.g. for the historical
backfill).

Guiding bias: **leave as many future options open as possible** — capture more
than we model, never overwrite, record provenance, make everything re-runnable.

> **STATUS (2026-06-26): PAUSED at a clean checkpoint.** Phases 0–2 here (= ROADMAP
> 10.0, 10.1a–d, 10.2a–c) are **DONE, shipped & verified on prod** — the live
> upload path banks the full metadata set and reads use the effective capture
> date. Remaining: the async enrichment worker (ROADMAP 10.1e, deferred until the
> 10.5 backends exist) and the separate opt-in tracks below — **Phase 3
> (historical backfill)** is the next big payoff. Implementation lives in
> `src/lib/media/{capture-date,extract,image-hash}.ts`, the upload `complete`
> route, and `src/lib/order.ts`; see `docs/STATE.md` for the resume pointer.

---

## Why (problems in today's pipeline)

Everything collapses to one timezone-less string `posts.date`
(`"YYYY-MM-DD HH:MM:SS.mmm"`), then read under two different conventions:
ordering (`ORDER BY p.date, p.id`, lexicographic), grouping
(`strftime(...)`, treated as UTC), display (`new Date(date)`, treated as local).

Concrete edge cases:
1. **Photo EXIF is interpreted two ways.** Client: `exifr` reads naive EXIF as
   browser-local → `.toISOString()` (UTC). Server fallback: `new Date("...")`
   with no `Z` → treated as server-local (UTC on Vercel). Same photo can land on
   a different instant/day depending on which path ran and the uploader's tz.
2. **Photos vs videos diverge.** Videos now carry a true offset
   (`com.apple.quicktime.creationdate`); photos use offset-less EXIF. Same-minute
   shots can sort apart / group to different days.
3. **No capture date → upload time.** Screenshots, stripped/downloaded images,
   scans, old clips fall to `new Date()` and pollute "recent" + On This Day.
4. **Random tiebreaker.** Same-instant posts order by random `nanoid` id.
5. **`datetime-local` manual entry** is stored as UTC literally — inconsistent
   with the photo path.
6. **Per-media dates are discarded** — only `firstExifDate` becomes the post
   date; `media` rows carry no capture date.
7. Minor: `media.duration` column exists but is never written; filename-date
   regex can false-positive; HEIC canvas compression can fail on non-Safari.

---

## Core principles

- **Separate ordering from grouping.** Store a precise instant (`taken_at`, UTC)
  for ordering and a capture-local calendar day (`local_date`) for grouping /
  "on this day", so timezone never moves a photo to the wrong day.
- **One date model for photos and videos** (instant + offset + local date +
  source/confidence).
- **Capture the firehose, model later.** Keep full raw metadata payloads so a
  future feature never needs a re-scan.
- **Additive & reversible.** New columns/tables only; never overwrite
  `posts.date` until a separate, audited "promote" step.
- **One enrichment pipeline** serves both live uploads and the historical
  backfill; pluggable backends; versioned and idempotent.

---

## Data model

All additive/nullable. Capture lives on **`media`**; a thin rollup lands on
**`posts`** for cheap list queries.

### `media`
| Group | Fields |
|---|---|
| Time | `taken_at` (UTC ISO), `tz_offset` (min), `local_date` (`YYYY-MM-DD`), `date_source`, `date_confidence` |
| Place | `gps_lat`, `gps_lng`, `gps_altitude`, `place` (cached reverse-geocode) |
| Device | `camera_make`, `camera_model`, `lens`, capture settings (ISO/aperture/shutter) |
| Media | `duration`, `fps`, `codec`, `is_live`, `is_screenshot`, `dominant_color`, `aspect`, `orientation` |
| Identity | `content_hash` (SHA-256 of original), `phash` (perceptual), `original_filename` |
| Enrichment | `caption`, `embedding` (vector), `quality_score`, `enrichment_status`, `enrichment_version`, `enriched_at` |
| Provenance | `source`; rows in `media_sources`; raw blob in `media_metadata_raw` |

`date_source` ∈ `exif | exif_offset | video_meta | filename | file_mtime |
manual | upload_fallback`.

### `posts` (rollup)
`taken_at` (UTC, representative = earliest media), `local_date`, `date_source`,
`source` (`upload | bulk | tumblr | shared`).

### New tables
- **`media_metadata_raw`** — full extracted payload as JSON per media + source
  (entire EXIF, video atom dump, full Apple Photos record). Model what we know;
  keep everything else verbatim.
- **`media_sources`** — links a media item to each origin: `kind`
  (`apple_photos | dropbox | icloud | google | filesystem | upload`), external id
  (Apple Photos UUID, Dropbox path, Takeout id), `content_hash`, `phash`,
  `matched_at`, `match_method`, `match_confidence`. Enables re-sync, audit, and
  multi-source corroboration.

### Tags/people/albums
Auto-derived tags/people/albums reuse existing tables but carry a `source`
(`auto` vs `human`) so regenerated auto data never clobbers manual curation.

---

## Sorting & grouping (the fix)
- **Order:** `ORDER BY taken_at, created_at, id` (instant → insert order → id).
- **Group:** archive months + On This Day key on `local_date` (tz-independent).
- **Cursor pagination:** `(taken_at, id)`.

---

## Enrichment pipeline (live + backfill share this)

Two tiers so uploads never block on ML:

- **Synchronous (at upload, private, no external calls):** read from the
  original *before* compression — dates/offset, GPS, device, dimensions,
  `content_hash`, `phash`, dominant color. Post publishes immediately.
- **Asynchronous (queued):** faces, scene tags, caption, embedding, quality
  score. Upload marks media `enrichment_status='pending'`; a worker processes it
  and flips to `done`.

Properties:
- **Pluggable backends per stage** — on-device/local model (private) or
  cloud/LLM (richer). Privacy fork applies per stage (see below).
- **Versioned + idempotent** (`enrichment_version`) → re-runnable as models
  improve; safe to re-process.
- **Where it runs:** a worker on **Railway** (long-lived process and/or a
  frequent cron draining the `pending` queue, mirroring the daily-memories cron).
  Fire right after upload for near-real-time; cron is the safety net.
- **Same enricher feeds the backfill** — only the feeder differs (live queue vs
  indexed back catalog).

---

## Privacy

Family photos, often children. Default to on-device/local:
- **Faces + basic scene tags:** on-device (Apple Photos for backfill; a
  local/server model for live) — images never leave to a third party.
- **Cloud vision / LLM captioning:** opt-in and deliberate, since it uploads
  images externally. A local multimodal model is the private alternative.
- **GPS is sensitive:** store for the private album, but **never expose precise
  coordinates on public `/m/` share pages or any future map** — strip/round
  before anything public.

---

## Phases (each shippable)

**Phase 0 — Schema (additive, safe).** Add columns, `media_metadata_raw`,
`media_sources`. No behavior change.

**Phase 1 — Capture + real-time enrichment for live uploads.**
- Synchronous extraction from originals (photo EXIF incl. `OffsetTimeOriginal` +
  GPS + device; video container incl. GPS/duration/fps/codec; hashes; dominant
  color). Server fallback uses the *same* rule as the client so they can't
  disagree.
- Async enrichment queue + worker (faces/scene/caption/embedding/score),
  pluggable + versioned.
- Fix HEIC compression reliability on non-Safari while here.

**Phase 2 — Flip reads + estimated-date UX.** Order by `taken_at`; group by
`local_date`; show an "estimated date" badge for low-confidence items with a
quick fix.

*— end of live work; backfill is a separate track below —*

**Phase 3 — Historical backfill (multi-source; runs on a machine without Claude).**
Two-tool split:
- **Tool A — Indexer (you run it there, unaided):** read-only, idempotent,
  resumable, dry-run-able. Walks each source, emits one portable index file
  (`.sqlite`/`.jsonl`) with `phash`, `content_hash`, full metadata, and (from
  Apple Photos) faces/keywords/albums/scene labels/quality score. You copy that
  file back.
- **Tool B — Matcher/Applier (runs with Claude):** computes phashes for stored
  thumbnails, perceptual-matches to originals (disambiguated by capture-time +
  aspect), queues ambiguous cases to confirm, applies metadata to **new columns
  only** via an authed admin endpoint.

Source adapters:
| Source | How | Bonus richness |
|---|---|---|
| Apple Photos / iCloud Photos | `osxphotos` (handles iCloud download, Live Photos, edited-vs-original) | **named faces, scene/object labels, keywords, albums, captions, favorites, quality scores** — all on-device |
| Dropbox / iCloud Drive / folders | filesystem walk | folder/path event+date hints |
| Google Photos | Takeout `.json` sidecars | Google date/geo/people |
| Lightroom/Adobe | XMP sidecars | ratings, keywords, captions |

Notes: cropped-on-upload photos and videos are the manual-leaning matches
(videos match on poster-frame phash + duration). Coverage = surviving originals;
iCloud-only must download first. Same index reveals local originals with **no
album match** → an optional "memories you never uploaded" queue.

**Phase 4 — Features built on banked data (optional).** Map view, dedup
warnings, auto-trip albums (cluster by embedding/time/place), place/camera/
date-range search, smarter On This Day picks (quality score).

**Phase 5 — Semantic enrichment (optional, pluggable).** Captions + open-
vocabulary tags + per-photo **embeddings** for similarity/semantic search
("kids in the snow") with no predefined vocabulary. Local CLIP (private) or
vision LLM (richer). Stored in libSQL vector column; feeds FTS + semantic search.
This is the same enricher Phase 1 runs live.

---

## Future features this unlocks
Map/"near here", auto-trip albums, dedup & near-dup detection (phash),
"Grandad's camera" device views, semantic + place + date-range search,
quality-ranked teasers, "rediscover un-uploaded memories", auto photo-book
narratives.

---

## Open decisions
1. **Original archival:** also stash full-res originals in R2 cold storage (best
   quality + permanent metadata) — more cost. Leave the hook now regardless.
2. **Auto-apply threshold** for backfill matches before requiring confirm (start
   conservative).
3. **Indexer stack:** Python for the Apple Photos adapter (so it can use
   `osxphotos`) + a thin filesystem adapter; unified by the common index format.
4. **Enrichment backends:** which stages run local vs external (privacy vs
   richness), per the privacy section.

---

## Build order
Phase 0 + 1 first (schema + capture + live enrichment) — low risk, immediately
banks data every later phase depends on. Then Phase 2 (the correctness flip).
Backfill (Phase 3) and semantic enrichment (Phase 5) are separate, opt-in tracks
after the live path is solid.
