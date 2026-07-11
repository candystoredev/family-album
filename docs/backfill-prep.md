# Phase 10.3 backfill — prep checklist (fill in opportunistically)

> **Status: PARKED — waiting on Tom to gather source files across machines.**
> This is NOT blocked on code. Phase 10.3 (matching your local originals to the
> migrated posts to apply real dates/GPS/faces + bank full-res originals) needs
> the source photo files, which live across several computers/apps. Jot down
> where things are here whenever you have a few minutes — you don't need to
> *move* or *organize* anything yet, just note where it lives. When you're back
> and ready, this map turns "dig through everything" into "point the tool at
> these N places."

## What the backfill will consume (so you know what to look for)
Originals from anywhere the family's photos live — especially the **pre-Tumblr
era** and anything the migration didn't capture. Sources the plan already
supports: **Apple Photos / iCloud** (via `osxphotos` — also gives faces, scene
labels, keywords, albums, favorites, quality scores, all on-device), **Dropbox /
iCloud Drive / loose folders**, **Google Photos Takeout** (`.json` sidecars),
**Lightroom / XMP sidecars** (ratings, keywords, captions).

## Inventory — one row per place photos live
Fill in as you remember them. Rough is fine.

| Computer / device | Where the photos are (app or folder path) | Rough date range | Local or cloud-only? | Notes |
|---|---|---|---|---|
| _e.g. Tom's MacBook_ | _Apple Photos library_ | _2008–2015_ | _some iCloud-only_ | _needs download first_ |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

## Quick prompts to jog memory
- [ ] Which Mac(s) hold the main **Apple Photos** library? Is it fully downloaded or **iCloud-optimized** (thumbnails only — those need downloading before indexing)?
- [ ] Any **old external drives / SD cards / backup disks** with originals?
- [ ] **Dropbox / Google Drive / iCloud Drive** folders of photos? Which account, roughly which years?
- [ ] Ever done a **Google Photos Takeout**? (those `.json` sidecars carry dates/geo/people)
- [ ] **Lightroom** or other catalog with edits/ratings/keywords worth pulling?
- [ ] Which **date ranges predate the Tumblr blog** (~2012) — the migration never had those?
- [ ] Old phones / a partner's devices with photos not in the shared library?

## When you're back — what happens next (no action needed now)
1. I build the **Indexer** (Tool A): a read-only script you run on each source above; it emits one portable index file (phashes + metadata + Apple Photos richness). You run it per place, whenever convenient, and collect the output files.
2. You hand the index files back; I build the **Matcher/Applier** (Tool B): phash-matches them to the migrated thumbnails, you confirm ambiguous cases, and it writes real capture dates / GPS / faces to the new columns (and banks full-res originals to the private `originals/` prefix).

Nothing here is urgent. The roadmap keeps moving (Phase 13 debt paydown, parts of
Phase 14) without any of this.
