"""Filesystem adapter end-to-end: index a temp dir, assert rows/hashes/EXIF."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3

from conftest import write_jpg, write_jpg_with_exif, write_png
import index as cli


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        h.update(fh.read())
    return h.hexdigest()


def _build_source(dirp) -> dict:
    d = str(dirp)
    paths = {
        "exif": write_jpg_with_exif(os.path.join(d, "IMG_exif.jpg"), "color"),
        "png": write_png(os.path.join(d, "plain.png"), "checker"),
        "noise": write_jpg(os.path.join(d, "shot.jpg"), "noise", seed=5),
    }
    # noise that must be ignored: a non-image and an AppleDouble sidecar.
    with open(os.path.join(d, "notes.txt"), "w") as fh:
        fh.write("not an image")
    with open(os.path.join(d, "._IMG_exif.jpg"), "wb") as fh:
        fh.write(b"\x00\x05\x16\x07")  # AppleDouble junk
    # nested subdir to prove recursion
    sub = os.path.join(d, "2012")
    os.makedirs(sub, exist_ok=True)
    paths["nested"] = write_jpg(os.path.join(sub, "beach.jpg"), "hgrad")
    return paths


def test_index_filesystem_rows_hashes_exif(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    paths = _build_source(src)
    dbfile = str(tmp_path / "index.sqlite")

    rc = cli.main([str(src), "--output", dbfile, "--source-kind", "filesystem"])
    assert rc == 0

    conn = sqlite3.connect(dbfile)
    conn.row_factory = sqlite3.Row
    rows = {r["path"]: r for r in conn.execute("SELECT * FROM media")}

    # 4 images indexed; .txt and AppleDouble excluded.
    assert len(rows) == 4
    assert os.path.abspath(paths["exif"]) in rows
    assert not any(os.path.basename(p).startswith("._") for p in rows)
    assert not any(p.endswith("notes.txt") for p in rows)

    # Content hashes match a straight SHA-256 of the file bytes.
    for key in ("exif", "png", "noise", "nested"):
        r = rows[os.path.abspath(paths[key])]
        assert r["content_hash"] == _sha256(paths[key])
        assert r["phash"] and len(r["phash"]) == 16
        assert r["source_kind"] == "filesystem"
        assert r["phash_engine"] in ("pyvips", "pillow-fallback")

    # EXIF row: date resolution, tz, GPS, device, dims, raw firehose.
    e = rows[os.path.abspath(paths["exif"])]
    assert e["taken_at"] == "2019-07-04T13:30:00.000Z"  # 15:30 +02:00 -> 13:30 UTC
    assert e["local_date"] == "2019-07-04"
    assert e["tz_offset"] == 120
    assert e["date_source"] == "exif_offset"
    assert e["date_confidence"] == "high"
    assert abs(e["gps_lat"] - 51.5) < 1e-6
    assert abs(e["gps_lng"] - (-0.1166667)) < 1e-4
    assert abs(e["gps_altitude"] - 35.0) < 1e-6
    assert e["camera_make"] == "TestCam"
    assert e["camera_model"] == "Model X"
    assert e["width"] == 320 and e["height"] == 240
    assert e["mime"] == "image/jpeg"
    assert e["original_filename"] == "IMG_exif.jpg"
    raw = json.loads(e["raw_metadata"])
    assert raw["exif"]["Make"] == "TestCam"
    assert "DateTimeOriginal" in raw["exif"]

    # meta + sources bookkeeping.
    meta = dict(conn.execute("SELECT key, value FROM meta"))
    assert meta["schema_version"] == "1"
    assert meta["phash_algo"].startswith("dhash-9x8")
    s = conn.execute("SELECT * FROM sources").fetchone()
    assert s["file_count"] == 4 and s["source_kind"] == "filesystem"
    assert s["finished_at"] is not None
    conn.close()


def test_naive_exif_without_offset(tmp_path):
    """EXIF date with no offset -> source 'exif', tz null, day from wall-clock."""
    src = tmp_path / "src2"
    src.mkdir()
    p = write_jpg_with_exif(
        os.path.join(str(src), "naive.jpg"),
        "color",
        dt="2008:12:31 23:59:00",
        offset="",  # no OffsetTimeOriginal
        lat_dms=None,  # no GPS
    )
    dbfile = str(tmp_path / "i.sqlite")
    assert cli.main([str(src), "--output", dbfile]) == 0
    conn = sqlite3.connect(dbfile)
    conn.row_factory = sqlite3.Row
    r = conn.execute("SELECT * FROM media WHERE path = ?", (os.path.abspath(p),)).fetchone()
    assert r["taken_at"] == "2008-12-31T23:59:00.000Z"
    assert r["tz_offset"] is None
    assert r["local_date"] == "2008-12-31"
    assert r["date_source"] == "exif"
    assert r["date_confidence"] == "medium"
    assert r["gps_lat"] is None and r["gps_lng"] is None
    conn.close()


def test_filename_date_fallback(tmp_path):
    """No EXIF date -> date parsed from the filename at low confidence."""
    src = tmp_path / "src3"
    src.mkdir()
    p = write_png(os.path.join(str(src), "2015-08-20_picnic.png"), "checker")
    dbfile = str(tmp_path / "i.sqlite")
    assert cli.main([str(src), "--output", dbfile]) == 0
    conn = sqlite3.connect(dbfile)
    conn.row_factory = sqlite3.Row
    r = conn.execute("SELECT * FROM media WHERE path = ?", (os.path.abspath(p),)).fetchone()
    assert r["local_date"] == "2015-08-20"
    assert r["date_source"] == "filename"
    assert r["taken_at"] == "2015-08-20T12:00:00.000Z"
    conn.close()
