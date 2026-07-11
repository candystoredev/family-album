"""Apple Photos / iCloud Photos adapter (via ``osxphotos``).

SCAFFOLD. This adapter needs macOS and a real Photos library, so it cannot be
exercised in this repo's test suite — the structure and field mapping below are
correct and documented, but marked as untested-here. The ``osxphotos`` import is
guarded so the rest of the tool (and ``--source-kind filesystem``) runs on any
machine without it installed.

Why Apple Photos is the richest source
--------------------------------------
Beyond EXIF, the Photos database carries on-device intelligence the album wants
and that never leaves the machine: **named faces / persons**, **scene & object
labels**, **keywords**, **album membership**, **captions/descriptions**,
**favorites**, and Apple's **aesthetic quality scores**. It also resolves the
messy parts of a real library: iCloud-optimised originals (download on demand),
Live Photos, and edited-vs-original versions.

Mapping to the index
---------------------
Each ``osxphotos.PhotoInfo`` becomes one ``media`` row. The perceptual hash and
content hash are still computed **from the original image bytes** (via the shared
:func:`filesystem.build_file_record`) so they stay byte-comparable with Tool B —
we do not trust any hash Apple might expose. The Apple-specific richness is
attached under ``raw_metadata.apple_photos`` and the flat columns are filled from
osxphotos fields:

    uuid                 -> external_id
    original_filename    -> original_filename
    date (tz-aware)      -> taken_at (UTC) + local_date + tz_offset
    latitude, longitude  -> gps_lat, gps_lng
    exif_info.camera_*   -> camera_make / camera_model
    width, height        -> width / height
    persons / face_info  -> raw_metadata.apple_photos.persons / faces
    labels / keywords    -> raw_metadata.apple_photos.labels / keywords
    albums               -> raw_metadata.apple_photos.albums
    favorite, score      -> raw_metadata.apple_photos.favorite / score

Usage (on a Mac, once osxphotos is installed)::

    pip install osxphotos
    python index.py "" --source-kind apple_photos --output apple.sqlite
    # (source_path is ignored for apple_photos; the system Photos library is used,
    #  or pass --library /path/to/Photos\ Library.photoslibrary)
"""

from __future__ import annotations

from datetime import timezone
from typing import Any, Callable, Dict, Iterator, Optional

try:  # only needed for --source-kind apple_photos
    import osxphotos  # type: ignore

    _HAVE_OSXPHOTOS = True
except Exception:  # pragma: no cover - osxphotos is macOS-only and optional
    osxphotos = None  # type: ignore
    _HAVE_OSXPHOTOS = False

SOURCE_KIND = "apple_photos"


def available() -> bool:
    """True iff osxphotos can be imported (macOS + ``pip install osxphotos``)."""
    return _HAVE_OSXPHOTOS


def _apple_raw(photo: Any) -> Dict[str, Any]:
    """Collect the on-device richness Apple Photos provides into a JSON payload.

    Defensive: osxphotos fields vary by macOS version, so every access is
    optional and failures degrade to omission rather than crashing a long run.
    """
    def safe(fn: Callable[[], Any], default: Any = None) -> Any:
        try:
            return fn()
        except Exception:
            return default

    faces = []
    for f in safe(lambda: photo.face_info, []) or []:
        faces.append(
            {
                "name": safe(lambda: f.name),
                "quality": safe(lambda: f.quality),
                "center": safe(lambda: (f.center_x, f.center_y)),
            }
        )

    score = safe(lambda: photo.score)
    score_payload = None
    if score is not None:
        score_payload = {
            "overall": safe(lambda: score.overall),
            "curation": safe(lambda: score.curation),
            "aesthetic": safe(lambda: getattr(score, "harmonious_color", None)),
        }

    return {
        "uuid": safe(lambda: photo.uuid),
        "persons": safe(lambda: list(photo.persons), []),
        "faces": faces,
        "keywords": safe(lambda: list(photo.keywords), []),
        "labels": safe(lambda: list(photo.labels), []),
        "albums": safe(lambda: list(photo.albums), []),
        "title": safe(lambda: photo.title),
        "description": safe(lambda: photo.description),
        "favorite": safe(lambda: photo.favorite),
        "hidden": safe(lambda: photo.hidden),
        "is_live": safe(lambda: photo.live_photo),
        "is_screenshot": safe(lambda: photo.screenshot),
        "is_edited": safe(lambda: photo.hasadjustments),
        "score": score_payload,
        "original_filename": safe(lambda: photo.original_filename),
    }


def iter_records(
    build_file_record: Callable[..., Dict[str, Any]],
    library: Optional[str] = None,
    download_missing: bool = False,
) -> Iterator[Dict[str, Any]]:
    """Yield an index row per photo in the Photos library.

    ``build_file_record`` is injected (the shared filesystem builder) so hashes
    are computed from the original bytes exactly as for the filesystem adapter.
    ``download_missing`` would fetch iCloud-optimised originals first (slow,
    network) — left to the caller to opt into.

    NOTE: untested in this repo (needs macOS + a Photos library). The control
    flow is intentionally simple and defensive.
    """
    if not _HAVE_OSXPHOTOS:
        raise RuntimeError(
            "osxphotos is not installed. Run `pip install osxphotos` on macOS to "
            "index an Apple Photos library."
        )

    photosdb = osxphotos.PhotosDB(dbfile=library) if library else osxphotos.PhotosDB()

    for photo in photosdb.photos():
        # Resolve a readable original path (optionally downloading from iCloud).
        path = None
        try:
            path = photo.path  # local original, if present
            if path is None and download_missing:
                paths = photo.export(  # noqa: F841 - real impl exports/downloads then re-reads
                    dest="/tmp", download_missing=True
                )
                path = paths[0] if paths else None
        except Exception:
            path = None

        if not path:
            # iCloud-only and not downloaded: still record identity + Apple richness,
            # but without hashes (Tool B can't perceptually match these until the
            # original is fetched). Skipped by default to keep the index honest.
            continue

        record = build_file_record(
            path,
            source_kind=SOURCE_KIND,
            external_id=_safe_uuid(photo),
            extra_raw={"apple_photos": _apple_raw(photo)},
        )

        # Prefer Apple's tz-aware capture date over re-derived EXIF when present.
        try:
            dt = photo.date
            if dt is not None and dt.tzinfo is not None:
                utc = dt.astimezone(timezone.utc)
                record["taken_at"] = utc.strftime("%Y-%m-%dT%H:%M:%S.000Z")
                record["local_date"] = f"{dt.year:04d}-{dt.month:02d}-{dt.day:02d}"
                record["tz_offset"] = int(dt.utcoffset().total_seconds() // 60)
                record["date_source"] = "apple_photos"
                record["date_confidence"] = "high"
        except Exception:
            pass

        yield record


def _safe_uuid(photo: Any) -> Optional[str]:
    try:
        return photo.uuid
    except Exception:
        return None
