"""The portable index — a single SQLite file (Tool A's only output).

One row per media file in ``media`` (absolute path as the primary key), a
``sources`` row per indexed root for resumability, and a ``meta`` table pinning
the schema version and the exact phash algorithm parameters so Tool B can verify
it is matching like-for-like.

Idempotent + resumable: :func:`already_indexed` lets a re-run skip files whose
absolute path is present with an unchanged ``(size, mtime)`` signature — no
re-hash, no re-read. When a file *has* changed (or ``--force``), :func:`upsert`
does an ``INSERT OR REPLACE`` keyed on the path, so re-indexing never duplicates
rows and always converges to the current bytes on disk.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

SCHEMA_VERSION = 1

# Kept in the `meta` table so Tool B can assert the hash is comparable.
PHASH_ALGO = "dhash-9x8-linear-rec709-lanczos3-v1"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS media (
    path             TEXT PRIMARY KEY,   -- absolute path on the indexing machine
    content_hash     TEXT NOT NULL,      -- SHA-256 of original bytes, lowercase hex
    phash            TEXT,               -- dHash, 16 hex chars (may be NULL if unreadable)
    taken_at         TEXT,               -- UTC ISO instant, for ordering
    local_date       TEXT,               -- capture-local YYYY-MM-DD, for grouping
    tz_offset        INTEGER,            -- minutes east of UTC, if known
    date_source      TEXT,               -- exif_offset | exif | filename | file_mtime | NULL
    date_confidence  TEXT,               -- high | medium | low | NULL
    gps_lat          REAL,
    gps_lng          REAL,
    gps_altitude     REAL,
    camera_make      TEXT,
    camera_model     TEXT,
    width            INTEGER,
    height           INTEGER,
    mime             TEXT,
    original_filename TEXT,
    size_bytes       INTEGER,
    mtime_ns         INTEGER,            -- st_mtime in ms; resume signature with size_bytes
    source_kind      TEXT NOT NULL,      -- filesystem | apple_photos | google_takeout | xmp
    external_id      TEXT,               -- e.g. Apple Photos UUID, Takeout id
    phash_engine     TEXT,               -- pyvips (byte-exact) | pillow-fallback
    raw_metadata     TEXT,               -- JSON firehose: full EXIF / adapter record
    indexed_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_phash ON media(phash);
CREATE INDEX IF NOT EXISTS idx_media_content ON media(content_hash);
CREATE INDEX IF NOT EXISTS idx_media_local_date ON media(local_date);

CREATE TABLE IF NOT EXISTS sources (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    root         TEXT NOT NULL,          -- absolute root this run walked
    source_kind  TEXT NOT NULL,
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    file_count   INTEGER,               -- files indexed/updated this run
    skipped_count INTEGER,              -- files skipped as already-indexed
    tool_version TEXT,
    phash_engine TEXT
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""

# Column order for INSERT OR REPLACE.
_COLUMNS = [
    "path",
    "content_hash",
    "phash",
    "taken_at",
    "local_date",
    "tz_offset",
    "date_source",
    "date_confidence",
    "gps_lat",
    "gps_lng",
    "gps_altitude",
    "camera_make",
    "camera_model",
    "width",
    "height",
    "mime",
    "original_filename",
    "size_bytes",
    "mtime_ns",
    "source_kind",
    "external_id",
    "phash_engine",
    "raw_metadata",
    "indexed_at",
]


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class IndexDB:
    """Thin wrapper over the SQLite index file."""

    def __init__(self, path: str, tool_version: str = "0.1.0"):
        self.path = path
        self.tool_version = tool_version
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(_SCHEMA)
        self._set_meta_once("schema_version", str(SCHEMA_VERSION))
        self._set_meta_once("phash_algo", PHASH_ALGO)
        self._set_meta_once("created_at", _now())
        self.conn.commit()

    # -- meta ---------------------------------------------------------------

    def _set_meta_once(self, key: str, value: str) -> None:
        self.conn.execute(
            "INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", (key, value)
        )

    def set_meta(self, key: str, value: str) -> None:
        self.conn.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", (key, value)
        )
        self.conn.commit()

    def get_meta(self, key: str) -> Optional[str]:
        row = self.conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    # -- resume -------------------------------------------------------------

    def already_indexed(self, path: str, size_bytes: int, mtime_ms: int) -> bool:
        """True iff ``path`` is present with the same size + mtime signature.

        Lets a re-run skip unchanged files without re-reading or re-hashing them.
        A changed file (different size/mtime) returns False so it gets re-indexed.
        """
        row = self.conn.execute(
            "SELECT size_bytes, mtime_ns FROM media WHERE path = ?", (path,)
        ).fetchone()
        if row is None:
            return False
        return row["size_bytes"] == size_bytes and row["mtime_ns"] == mtime_ms

    # -- writes -------------------------------------------------------------

    def upsert(self, row: Dict[str, Any]) -> None:
        """INSERT OR REPLACE one media row (keyed on ``path``)."""
        row = dict(row)
        row.setdefault("indexed_at", _now())
        values = [row.get(col) for col in _COLUMNS]
        placeholders = ", ".join("?" for _ in _COLUMNS)
        cols = ", ".join(_COLUMNS)
        self.conn.execute(
            f"INSERT OR REPLACE INTO media ({cols}) VALUES ({placeholders})", values
        )

    def begin_source(self, root: str, source_kind: str, phash_engine: str) -> int:
        cur = self.conn.execute(
            "INSERT INTO sources (root, source_kind, started_at, tool_version, phash_engine) "
            "VALUES (?, ?, ?, ?, ?)",
            (root, source_kind, _now(), self.tool_version, phash_engine),
        )
        self.conn.commit()
        return cur.lastrowid

    def finish_source(self, source_id: int, file_count: int, skipped_count: int) -> None:
        self.conn.execute(
            "UPDATE sources SET finished_at = ?, file_count = ?, skipped_count = ? WHERE id = ?",
            (_now(), file_count, skipped_count, source_id),
        )
        self.conn.commit()

    def commit(self) -> None:
        self.conn.commit()

    def count(self) -> int:
        return self.conn.execute("SELECT COUNT(*) AS n FROM media").fetchone()["n"]

    def iter_rows(self) -> Iterable[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM media ORDER BY path")

    def close(self) -> None:
        self.conn.commit()
        self.conn.close()

    def __enter__(self) -> "IndexDB":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()
