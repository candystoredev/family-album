"""Backfill Indexer (Tool A) — read-only, portable photo indexer.

Walks a photo source and emits one SQLite index file with a perceptual hash, a
content hash, and extracted metadata per file, for the album's Phase 10.3
historical backfill. See ``tools/backfill-indexer/README.md``.
"""

__version__ = "0.1.0"
