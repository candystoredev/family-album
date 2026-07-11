"""Idempotency + resume: re-indexing never duplicates and skips unchanged files."""

from __future__ import annotations

import os
import sqlite3
import time

from conftest import write_jpg, write_png
import index as cli


def _rows(dbfile):
    conn = sqlite3.connect(dbfile)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute("SELECT COUNT(*) AS n FROM media").fetchone()["n"], [
            dict(r) for r in conn.execute("SELECT * FROM sources ORDER BY id")
        ]
    finally:
        conn.close()


def _make_dir(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    write_jpg(os.path.join(str(src), "a.jpg"), "noise", seed=1)
    write_jpg(os.path.join(str(src), "b.jpg"), "noise", seed=2)
    write_png(os.path.join(str(src), "c.png"), "checker")
    return str(src)


def test_reindex_is_idempotent(tmp_path):
    src = _make_dir(tmp_path)
    dbfile = str(tmp_path / "index.sqlite")

    assert cli.main([src, "--output", dbfile]) == 0
    n1, sources1 = _rows(dbfile)
    assert n1 == 3
    assert sources1[-1]["file_count"] == 3 and sources1[-1]["skipped_count"] == 0

    # Second run: same bytes -> everything skipped, still exactly 3 rows.
    assert cli.main([src, "--output", dbfile]) == 0
    n2, sources2 = _rows(dbfile)
    assert n2 == 3  # no duplicates
    assert sources2[-1]["file_count"] == 0 and sources2[-1]["skipped_count"] == 3


def test_changed_file_is_reindexed(tmp_path):
    src = _make_dir(tmp_path)
    dbfile = str(tmp_path / "index.sqlite")
    assert cli.main([src, "--output", dbfile]) == 0

    # Rewrite one file with different content (new bytes + newer mtime).
    changed = os.path.join(src, "a.jpg")
    time.sleep(0.01)
    write_jpg(changed, "noise", seed=999)
    os.utime(changed, (time.time() + 5, time.time() + 5))

    assert cli.main([src, "--output", dbfile]) == 0
    n, sources = _rows(dbfile)
    assert n == 3  # replaced in place, not duplicated
    assert sources[-1]["file_count"] == 1 and sources[-1]["skipped_count"] == 2


def test_force_reindexes_everything(tmp_path):
    src = _make_dir(tmp_path)
    dbfile = str(tmp_path / "index.sqlite")
    assert cli.main([src, "--output", dbfile]) == 0
    assert cli.main([src, "--output", dbfile, "--force"]) == 0
    n, sources = _rows(dbfile)
    assert n == 3
    assert sources[-1]["file_count"] == 3 and sources[-1]["skipped_count"] == 0


def test_content_hash_updates_on_change(tmp_path):
    src = _make_dir(tmp_path)
    dbfile = str(tmp_path / "index.sqlite")
    assert cli.main([src, "--output", dbfile]) == 0

    conn = sqlite3.connect(dbfile)
    before = conn.execute(
        "SELECT content_hash FROM media WHERE path LIKE '%a.jpg'"
    ).fetchone()[0]
    conn.close()

    changed = os.path.join(src, "a.jpg")
    write_jpg(changed, "noise", seed=424242)
    os.utime(changed, (time.time() + 5, time.time() + 5))
    assert cli.main([src, "--output", dbfile]) == 0

    conn = sqlite3.connect(dbfile)
    after = conn.execute(
        "SELECT content_hash FROM media WHERE path LIKE '%a.jpg'"
    ).fetchone()[0]
    conn.close()
    assert before != after
