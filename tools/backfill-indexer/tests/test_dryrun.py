"""--dry-run reports what it would index and writes absolutely nothing."""

from __future__ import annotations

import os
import sqlite3

from conftest import write_jpg, write_png
import index as cli


def _make_dir(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    write_jpg(os.path.join(str(src), "a.jpg"), "noise", seed=1)
    write_png(os.path.join(str(src), "b.png"), "checker")
    return str(src)


def test_dry_run_creates_no_file(tmp_path, capsys):
    src = _make_dir(tmp_path)
    dbfile = str(tmp_path / "index.sqlite")

    rc = cli.main([src, "--output", dbfile, "--dry-run"])
    assert rc == 0
    assert not os.path.exists(dbfile)  # nothing written

    out = capsys.readouterr().out
    assert "DRY RUN" in out
    assert "2 to index" in out


def test_dry_run_respects_existing_index(tmp_path, capsys):
    src = _make_dir(tmp_path)
    dbfile = str(tmp_path / "index.sqlite")

    # Real run first.
    assert cli.main([src, "--output", dbfile]) == 0
    size_before = os.path.getsize(dbfile)
    mtime_before = os.path.getmtime(dbfile)
    sources_before = sqlite3.connect(dbfile).execute("SELECT COUNT(*) FROM sources").fetchone()[0]

    # Dry run over the same dir: reports all as already-indexed, touches nothing.
    capsys.readouterr()  # clear
    assert cli.main([src, "--output", dbfile, "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "0 to index" in out
    assert "2 already indexed" in out

    # The index file is byte-for-byte untouched (no new sources row, same size).
    assert os.path.getsize(dbfile) == size_before
    assert os.path.getmtime(dbfile) == mtime_before
    sources_after = sqlite3.connect(dbfile).execute("SELECT COUNT(*) FROM sources").fetchone()[0]
    assert sources_after == sources_before
