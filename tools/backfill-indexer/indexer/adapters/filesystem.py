"""Filesystem adapter — folders, Dropbox, iCloud Drive, loose photo dumps.

This is the testable core of the Indexer. It walks a directory tree, and for
each image file computes the content hash + perceptual hash and extracts EXIF
metadata into an index row. Fully read-only: it never writes, moves, or touches
the source files.

It also exposes :func:`build_file_record`, the shared "one file -> one row"
builder that the sidecar adapters (Google Takeout, XMP) reuse, merging their
extra metadata on top.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, Optional

from ..content_hash import sha256_hex
from ..exif_meta import extract_photo_meta
from ..phash import PHASH_ENGINE, perceptual_hash

# Extensions we treat as still images. HEIC/HEIF included: pyvips decodes them
# when the bundled libvips has libheif; otherwise phash is NULL for those and a
# note is left (the row is still indexed for its content hash + metadata).
IMAGE_EXTS = {
    ".jpg",
    ".jpeg",
    ".jpe",
    ".png",
    ".gif",
    ".webp",
    ".tif",
    ".tiff",
    ".bmp",
    ".heic",
    ".heif",
}


def is_image_file(path: str) -> bool:
    name = os.path.basename(path)
    if name.startswith("._") or name == ".DS_Store":
        return False  # AppleDouble / macOS metadata sidecars, not real images
    return os.path.splitext(name)[1].lower() in IMAGE_EXTS


def iter_media_files(root: str) -> Iterator[str]:
    """Yield absolute paths of candidate image files under ``root``, sorted for
    deterministic, resumable ordering. A single file path is also accepted."""
    root = os.path.abspath(root)
    if os.path.isfile(root):
        if is_image_file(root):
            yield root
        return
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            if is_image_file(full) and os.path.isfile(full):
                yield full


def build_file_record(
    path: str,
    source_kind: str,
    external_id: Optional[str] = None,
    extra_raw: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build a full index row for one image file (read-only).

    Computes content_hash + phash and extracts EXIF/metadata. ``extra_raw`` is
    merged under a namespaced key into ``raw_metadata`` so sidecar adapters can
    attach their source-specific payload without clobbering the EXIF firehose.
    """
    path = os.path.abspath(path)
    meta = extract_photo_meta(path)

    raw: Dict[str, Any] = {}
    if meta.get("raw"):
        raw["exif"] = meta["raw"]
    if extra_raw:
        raw.update(extra_raw)

    return {
        "path": path,
        "content_hash": sha256_hex(path),
        "phash": perceptual_hash(path),
        "taken_at": meta.get("taken_at"),
        "local_date": meta.get("local_date"),
        "tz_offset": meta.get("tz_offset"),
        "date_source": meta.get("date_source"),
        "date_confidence": meta.get("date_confidence"),
        "gps_lat": meta.get("gps_lat"),
        "gps_lng": meta.get("gps_lng"),
        "gps_altitude": meta.get("gps_altitude"),
        "camera_make": meta.get("camera_make"),
        "camera_model": meta.get("camera_model"),
        "width": meta.get("width"),
        "height": meta.get("height"),
        "mime": meta.get("mime"),
        "original_filename": meta.get("original_filename"),
        "size_bytes": meta.get("_size_bytes"),
        "mtime_ns": meta.get("_mtime_ms"),
        "source_kind": source_kind,
        "external_id": external_id,
        "phash_engine": PHASH_ENGINE,
        "raw_metadata": json.dumps(raw, ensure_ascii=False) if raw else None,
        "indexed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
    }
