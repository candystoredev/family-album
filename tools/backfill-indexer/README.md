# Backfill Indexer (Tool A)

A **read-only** indexer for the album's Phase 10.3 historical backfill. You run
it on your own machines (Macs, drives, folders); it walks a photo source and
emits **one portable SQLite file** with, per media file:

- a **perceptual hash** (dHash) that is **byte-identical to the album app's**,
- a **content hash** (SHA-256 of the original bytes),
- extracted **metadata** — capture date/time/offset, GPS, camera, dimensions,
  mime, original filename, and a JSON firehose of everything else.

You copy that `.sqlite` back, and a later, separate **Matcher (Tool B)** —
_not this tool_ — perceptually matches these hashes against the album's stored
thumbnails to apply real capture dates / GPS / faces to migrated posts. See
`docs/rich-metadata-plan.md` (Phase 3) and `docs/backfill-prep.md`.

It never modifies, moves, or writes to your source files. Its only output is the
index file you point `--output` at.

---

## Why the perceptual hash must match exactly

The whole two-tool design hinges on one thing: the hash this Indexer computes
from a **local original** must equal the hash the album computed from the
**re-encoded thumbnail** of the same photo. dHash is resolution-invariant by
design, so an original and its thumbnail land on the same 16-hex string — _but
only if both sides run the identical algorithm._

The album computes its hash in `src/lib/media/image-hash.ts` with **sharp** (a
wrapper around the **libvips** C library):

```
sharp(buf).greyscale().resize(9, 8, { fit: "fill" }).raw()
# then: per row, one bit per adjacent column pair (left < right),
#       8 rows x 8 comparisons = 64 bits -> 16 hex chars, MSB-first.
```

This Indexer reproduces that pipeline on **pyvips** — the Python binding for the
**same libvips** that sharp wraps — so the pixels (and therefore the bits) are
identical. Two behaviours had to be matched exactly, and both are covered by the
test suite against the app's real TypeScript code:

1. **Greyscale is linear-light Rec.709 luminance** (libvips `b-w`), not the
   Rec.601 luma that `PIL.convert("L")` uses. (Pure red → 127, green → 220,
   blue → 76.)
2. **JPEG shrink-on-load.** For JPEGs, sharp asks libjpeg to DCT-decode at 1/2,
   1/4 or 1/8 scale before the residual resize. The factor is the largest N in
   {8,4,2,1} for which the decoded image is still strictly larger than 9×8
   (`W/N > 9 and H/N > 8`). Non-JPEG formats decode whole.

**Result:** byte-identical hashes vs the app on JPEG and PNG, including the JPEG
shrink-on-load boundary sizes (verified in `tests/test_phash.py`, max byte diff
`0`). The stored `phash_algo` meta value is
`dhash-9x8-linear-rec709-lanczos3-v1`.

> The `pyvips[binary]` wheel **bundles libvips**, so this is a plain
> `pip install` with no system packages. If pyvips is somehow unavailable the
> tool still runs via a Pillow-only fallback, but that fallback matches the
> greyscale exactly while only approximating libvips' Lanczos resize (it can
> drift ~10–25 bits on hard-edged content) — it is a safety net, **not** a
> parity guarantee. Runs made with it are flagged (`phash_engine =
> 'pillow-fallback'`) so a non-parity index is never silent. Install pyvips.

---

## Install

```sh
cd tools/backfill-indexer
python3 -m venv .venv && source .venv/bin/activate   # or: uv venv
pip install -r requirements.txt                      # pyvips[binary] + Pillow
```

Python 3.9+. No system libraries required (libvips is bundled by the wheel).

For the tests: `pip install -r requirements-dev.txt` (adds pytest, numpy,
piexif). The perceptual-hash **parity test** additionally shells out to the
repo's `tsx` to run the app's real `perceptualHash`; it is skipped gracefully if
`tsx`/node is unavailable.

---

## Usage

```sh
# A folder / Dropbox / iCloud Drive tree (the fully-implemented core):
python index.py ~/Pictures/2012 --output index.sqlite

# Preview only — reports what it would index and writes NOTHING:
python index.py ~/Pictures --output index.sqlite --dry-run

# Apple Photos / iCloud (macOS; needs `pip install osxphotos`):
python index.py "" --source-kind apple_photos --output apple.sqlite
#   --library "/path/to/Photos Library.photoslibrary"   (default: system library)
#   --download-missing   fetch iCloud-optimised originals first (slow)

# Google Takeout tree (.json sidecars) / Lightroom XMP sidecars:
python index.py ~/Takeout --source-kind google_takeout --output takeout.sqlite
python index.py ~/RawEdits --source-kind xmp           --output xmp.sqlite
```

Flags: `--source-kind {filesystem,apple_photos,google_takeout,xmp}` (default
`filesystem`), `--output/-o`, `--dry-run`, `--force` (re-index even unchanged
files), `--verbose/-v`.

### Idempotent + resumable

Re-running against an existing index **skips files whose absolute path is present
with an unchanged `(size, mtime)` signature** — no re-read, no re-hash — so an
interrupted run just resumes, and a nightly re-run only picks up new/changed
files. Changed files are re-indexed in place via `INSERT OR REPLACE` keyed on the
path, so re-indexing **never duplicates rows**. `--force` ignores the skip and
re-indexes everything. Each run appends a row to the `sources` table
(`file_count`, `skipped_count`, timestamps) for auditing/resume.

---

## Output schema

One SQLite file. Key tables:

**`media`** — one row per file:

| column | meaning |
|---|---|
| `path` (PK) | absolute path on the indexing machine |
| `content_hash` | SHA-256 of the original bytes (lowercase hex) |
| `phash` | dHash, 16 hex chars — byte-identical to the app |
| `taken_at` | capture instant, UTC ISO (`…Z`), for ordering |
| `local_date` | capture-local `YYYY-MM-DD`, for grouping |
| `tz_offset` | minutes east of UTC, if known |
| `date_source` / `date_confidence` | `exif_offset`/`exif`/`filename`/`file_mtime`; `high`/`medium`/`low` |
| `gps_lat` / `gps_lng` / `gps_altitude` | decimal degrees / metres |
| `camera_make` / `camera_model` | device |
| `width` / `height` / `mime` / `original_filename` | |
| `size_bytes` / `mtime_ns` | resume signature |
| `source_kind` / `external_id` | adapter + source id (e.g. Apple Photos UUID) |
| `phash_engine` | `pyvips` (byte-exact) or `pillow-fallback` |
| `raw_metadata` | JSON firehose: full EXIF + adapter-specific payload |
| `indexed_at` | when this row was written |

**`sources`** — one row per indexed root per run (root, kind, started/finished,
counts, tool + engine versions) → resumability & audit.

**`meta`** — `schema_version`, `phash_algo`, `created_at`. Tool B reads
`phash_algo` to assert it is matching like-for-like.

Capture dates use the album's own resolution rule (a port of
`src/lib/media/capture-date.ts`): a naive EXIF time is never run through a
timezone-aware parser, `taken_at` is a deterministic UTC instant for ordering,
and `local_date` comes straight from the wall-clock components so no timezone can
move a photo to the wrong day.

---

## Source adapters

| adapter | status | notes |
|---|---|---|
| **filesystem** | **fully implemented + tested** | folders, Dropbox, iCloud Drive, loose dumps. The testable core. |
| **apple_photos** | **scaffold** (macOS only) | osxphotos. Maps uuid, tz-aware date, GPS, camera, **persons/faces, keywords, labels, albums, favorite, quality score** into the row + `raw_metadata.apple_photos`. Hashes still come from the original bytes. Import is guarded so the tool runs without osxphotos. Untestable here (needs a real Photos library). |
| **google_takeout** | light scaffold | overlays `.json` sidecar date/geo/people onto the filesystem record. |
| **xmp** | light scaffold | Lightroom/Adobe `.xmp` sidecar rating/keywords/caption. |

### What a real Apple Photos run needs (on a Mac)

1. `pip install osxphotos` in the venv.
2. Grant the terminal **Full Disk Access** (Photos library is protected).
3. Optionally `--download-missing` if the library is **iCloud-optimised**
   (thumbnails only) — originals must be downloaded before they can be hashed;
   iCloud-only items are skipped by default so the index stays honest.
4. `python index.py "" --source-kind apple_photos --output apple.sqlite`.

The osxphotos field mapping is written and documented in
`indexer/adapters/apple_photos.py`, but it cannot be exercised in CI here.

---

## Tests

```sh
pip install -r requirements-dev.txt
python -m pytest        # from tools/backfill-indexer/
```

Covers: the dHash port (**byte-parity vs the app's real `perceptualHash`**, known
vectors, bit-order, JPEG shrink-on-load boundaries), the filesystem adapter
(rows/hashes/EXIF/GPS/date resolution), idempotency & resume (index twice → no
dupes; changed file re-indexed; `--force`), and `--dry-run` (writes nothing).
