"""Google Photos Takeout adapter — ``.json`` sidecars (LIGHT SCAFFOLD).

A Google Photos Takeout is a filesystem tree of images, each accompanied by a
``<image>.<ext>.json`` (older exports) or ``<image>.<ext>.supplemental-
metadata.json`` sidecar carrying Google's own date/geo/people. Google commonly
strips or rewrites EXIF, so the sidecar is often the *only* reliable capture
date and GPS — this adapter's job is to overlay that sidecar on top of the
normal filesystem record.

Status: the sidecar discovery + parsing below is implemented for the common
Takeout shapes, but is only lightly exercised. Edge cases (truncated filenames,
``-edited`` variants, burst/motion-photo grouping, album ``metadata.json``) are
marked TODO.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterator, Optional

from .filesystem import iter_media_files

SOURCE_KIND = "google_takeout"


def _find_sidecar(image_path: str) -> Optional[str]:
    """Locate the Takeout JSON sidecar for ``image_path`` across known shapes."""
    candidates = [
        image_path + ".json",
        image_path + ".supplemental-metadata.json",
    ]
    # Google truncates long sidecar names; also try stripping an "-edited" suffix.
    base, ext = os.path.splitext(image_path)
    if base.endswith("-edited"):
        candidates.append(base[: -len("-edited")] + ext + ".json")
    for c in candidates:
        if os.path.isfile(c):
            return c
    # TODO: handle Google's name-truncation rules (e.g. 51-char cap) and the
    # "(1)" numbering that moves the counter inside the .json name.
    return None


def parse_sidecar(sidecar_path: str) -> Dict[str, Any]:
    """Parse a Takeout JSON sidecar into normalised overlay fields + raw payload.

    Returns keys among: ``taken_at``, ``local_date``, ``tz_offset`` (always None
    — Google timestamps are UTC epochs with no local offset), ``gps_lat``,
    ``gps_lng``, ``gps_altitude``, ``people``, ``raw``.
    """
    with open(sidecar_path, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    out: Dict[str, Any] = {"raw": data}

    # photoTakenTime.timestamp is seconds since the UTC epoch.
    taken = (data.get("photoTakenTime") or {}).get("timestamp")
    if taken is not None:
        try:
            dt = datetime.fromtimestamp(int(taken), tz=timezone.utc)
            out["taken_at"] = dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
            out["local_date"] = f"{dt.year:04d}-{dt.month:02d}-{dt.day:02d}"
            out["tz_offset"] = None
            out["date_source"] = "google_takeout"
            out["date_confidence"] = "medium"
        except (ValueError, OSError):
            pass

    geo = data.get("geoDataExif") or data.get("geoData") or {}
    lat, lng = geo.get("latitude"), geo.get("longitude")
    if lat or lng:  # Google writes 0.0/0.0 for "no geo"
        out["gps_lat"] = lat or None
        out["gps_lng"] = lng or None
        out["gps_altitude"] = geo.get("altitude") or None

    people = data.get("people")
    if people:
        out["people"] = [p.get("name") for p in people if isinstance(p, dict)]

    return out


def iter_records(
    root: str,
    build_file_record: Callable[..., Dict[str, Any]],
) -> Iterator[Dict[str, Any]]:
    """Yield an index row per image under ``root``, overlaying its Takeout sidecar.

    Hashes and EXIF come from the image via the shared filesystem builder; the
    sidecar (when found) overrides date/GPS and contributes people + raw payload.
    """
    for image_path in iter_media_files(root):
        sidecar = _find_sidecar(image_path)
        overlay = {}
        if sidecar:
            try:
                overlay = parse_sidecar(sidecar)
            except Exception:
                overlay = {}

        record = build_file_record(
            image_path,
            source_kind=SOURCE_KIND,
            extra_raw={"google_takeout": overlay.get("raw")} if overlay.get("raw") else None,
        )

        # Google sidecar is more trustworthy than the often-stripped EXIF.
        for k in ("taken_at", "local_date", "tz_offset", "date_source", "date_confidence"):
            if overlay.get(k) is not None:
                record[k] = overlay[k]
        for k in ("gps_lat", "gps_lng", "gps_altitude"):
            if overlay.get(k) is not None and record.get(k) is None:
                record[k] = overlay[k]

        yield record
