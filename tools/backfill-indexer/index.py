#!/usr/bin/env python3
"""Backfill Indexer (Tool A) — CLI entry point.

Read-only, idempotent, resumable indexer for the album's Phase 10.3 historical
backfill. Walks a photo source and emits ONE portable SQLite index file with a
perceptual hash (byte-identical to the album app's), a content hash, and
extracted metadata per file. A later, separate Matcher (Tool B) perceptually
matches these against the album's stored thumbnails to apply real capture dates /
GPS / faces to migrated posts.

Examples
--------
    # A folder / Dropbox / iCloud Drive tree (the fully-implemented core):
    python index.py ~/Pictures/2012 --output index.sqlite

    # See what it would do, writing nothing:
    python index.py ~/Pictures --output index.sqlite --dry-run

    # Apple Photos (macOS + `pip install osxphotos`), scaffolded:
    python index.py "" --source-kind apple_photos --output apple.sqlite

Re-running against an existing index skips files whose (path, size, mtime) are
unchanged, so an interrupted run resumes where it left off.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys

# Make `indexer` importable no matter the caller's CWD.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from indexer import __version__  # noqa: E402
from indexer.db import IndexDB  # noqa: E402
from indexer.phash import PHASH_ENGINE  # noqa: E402

SOURCE_KINDS = ("filesystem", "apple_photos", "google_takeout", "xmp")


def _file_sig(path: str):
    st = os.stat(path)
    return int(st.st_size), int(st.st_mtime * 1000)


def _already_indexed_ro(ro_conn, path, size, mtime) -> bool:
    """Resume check against an existing index opened read-only (for --dry-run)."""
    if ro_conn is None:
        return False
    try:
        row = ro_conn.execute(
            "SELECT size_bytes, mtime_ns FROM media WHERE path = ?", (os.path.abspath(path),)
        ).fetchone()
    except sqlite3.OperationalError:
        return False
    return bool(row and row[0] == size and row[1] == mtime)


def run(args) -> int:
    source_kind = args.source_kind
    dry_run = args.dry_run
    output = os.path.abspath(args.output)

    print(f"backfill-indexer {__version__}  |  source_kind={source_kind}  |  phash_engine={PHASH_ENGINE}")
    if PHASH_ENGINE != "pyvips":
        print(
            "  WARNING: pyvips not installed -> perceptual hashes use the Pillow "
            "fallback and are NOT guaranteed byte-identical to the album. "
            "Install 'pyvips[binary]' for the parity guarantee.",
            file=sys.stderr,
        )
    print(f"  output: {output}{'  (DRY RUN — nothing will be written)' if dry_run else ''}")

    # --- resolve the record iterator for this source kind ---
    from indexer.adapters.filesystem import build_file_record, iter_media_files

    if source_kind == "filesystem":
        source_root = os.path.abspath(args.source_path)
        if not os.path.exists(source_root):
            print(f"error: source path does not exist: {source_root}", file=sys.stderr)
            return 2
        file_paths = iter_media_files(source_root)
        records = None
    elif source_kind == "google_takeout":
        from indexer.adapters import google_takeout

        source_root = os.path.abspath(args.source_path)
        records = google_takeout.iter_records(source_root, build_file_record)
        file_paths = None
    elif source_kind == "xmp":
        from indexer.adapters import xmp

        source_root = os.path.abspath(args.source_path)
        records = xmp.iter_records(source_root, build_file_record)
        file_paths = None
    elif source_kind == "apple_photos":
        from indexer.adapters import apple_photos

        if not apple_photos.available():
            print(
                "error: osxphotos not installed. On macOS run `pip install osxphotos` "
                "to index an Apple Photos library.",
                file=sys.stderr,
            )
            return 2
        source_root = args.library or "(system Photos library)"
        records = apple_photos.iter_records(
            build_file_record, library=args.library, download_missing=args.download_missing
        )
        file_paths = None
    else:  # pragma: no cover - argparse restricts choices
        print(f"error: unknown source kind {source_kind}", file=sys.stderr)
        return 2

    # --- dry run: report, write nothing (don't even create the DB file) ---
    if dry_run:
        ro_conn = None
        if os.path.exists(output):
            try:
                ro_conn = sqlite3.connect(f"file:{output}?mode=ro", uri=True)
            except sqlite3.OperationalError:
                ro_conn = None
        would, skip, total = 0, 0, 0
        if file_paths is not None:  # filesystem: cheap path-only enumeration
            for path in file_paths:
                total += 1
                try:
                    size, mtime = _file_sig(path)
                except OSError:
                    continue
                if not args.force and _already_indexed_ro(ro_conn, path, size, mtime):
                    skip += 1
                else:
                    would += 1
                    if args.verbose:
                        print(f"  would index: {path}")
        else:  # sidecar/apple adapters yield full records; count them
            for rec in records:
                total += 1
                p = rec.get("path")
                sig_ok = False
                if p and os.path.exists(p):
                    try:
                        size, mtime = _file_sig(p)
                        sig_ok = not args.force and _already_indexed_ro(ro_conn, p, size, mtime)
                    except OSError:
                        sig_ok = False
                if sig_ok:
                    skip += 1
                else:
                    would += 1
                    if args.verbose:
                        print(f"  would index: {p}")
        if ro_conn is not None:
            ro_conn.close()
        print(f"DRY RUN: {total} candidate files — {would} to index, {skip} already indexed (skipped).")
        if not os.path.exists(output):
            print("  (no index file created)")
        return 0

    # --- real run ---
    db = IndexDB(output, tool_version=__version__)
    source_id = db.begin_source(source_root, source_kind, PHASH_ENGINE)
    indexed, skipped, total, errors = 0, 0, 0, 0
    try:
        if file_paths is not None:  # filesystem
            for path in file_paths:
                total += 1
                try:
                    size, mtime = _file_sig(path)
                except OSError:
                    errors += 1
                    continue
                if not args.force and db.already_indexed(path, size, mtime):
                    skipped += 1
                    continue
                try:
                    rec = build_file_record(path, "filesystem")
                    db.upsert(rec)
                    indexed += 1
                except Exception as e:  # never let one bad file abort a long run
                    errors += 1
                    print(f"  skip (error): {path}: {e}", file=sys.stderr)
                if indexed % 200 == 0:
                    db.commit()
                if args.verbose and indexed and indexed % 100 == 0:
                    print(f"  indexed {indexed} files...")
        else:  # adapter yields full records
            for rec in records:
                total += 1
                path = rec.get("path")
                if path and os.path.exists(path):
                    try:
                        size, mtime = _file_sig(path)
                        if not args.force and db.already_indexed(path, size, mtime):
                            skipped += 1
                            continue
                    except OSError:
                        pass
                try:
                    db.upsert(rec)
                    indexed += 1
                except Exception as e:
                    errors += 1
                    print(f"  skip (error): {path}: {e}", file=sys.stderr)
                if indexed % 200 == 0:
                    db.commit()
        db.finish_source(source_id, indexed, skipped)
        db.commit()
    finally:
        total_rows = db.count()
        db.close()

    print(
        f"Done. Indexed/updated {indexed}, skipped {skipped}, errors {errors} "
        f"(of {total} candidates). Index now holds {total_rows} rows: {output}"
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="index.py",
        description="Read-only photo indexer for the album's Phase 10.3 backfill (Tool A).",
    )
    p.add_argument(
        "source_path",
        help="Directory (or single file) to index. Ignored for --source-kind apple_photos.",
    )
    p.add_argument(
        "--output", "-o", default="index.sqlite", help="Output SQLite index file (default: index.sqlite)."
    )
    p.add_argument("--dry-run", action="store_true", help="Report what would be indexed; write nothing.")
    p.add_argument(
        "--source-kind",
        choices=SOURCE_KINDS,
        default="filesystem",
        help="Which adapter to use (default: filesystem).",
    )
    p.add_argument(
        "--force", action="store_true", help="Re-index every file even if unchanged (ignore resume)."
    )
    p.add_argument("--verbose", "-v", action="store_true", help="Print per-file progress.")
    # apple_photos options
    p.add_argument("--library", default=None, help="apple_photos: path to a .photoslibrary (default: system).")
    p.add_argument(
        "--download-missing",
        action="store_true",
        help="apple_photos: download iCloud-optimised originals before hashing (slow).",
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
