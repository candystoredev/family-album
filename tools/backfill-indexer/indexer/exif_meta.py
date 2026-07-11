"""EXIF / metadata extraction and capture-date resolution.

Reads a photo's EXIF with Pillow and normalises it into the index columns
(GPS, device, dimensions, mime) plus a verbatim ``raw`` dump for the
``raw_metadata`` firehose. The capture-date resolver is a faithful port of the
album's ``resolveCaptureDate`` (``src/lib/media/capture-date.ts``): same source
priority, same "never let the host timezone mangle a naive EXIF time" rule, same
``taken_at`` (UTC instant, for ordering) / ``local_date`` (capture-local day, for
grouping) / ``tz_offset`` split — so dates the Indexer banks line up with dates
the live upload path banks.

Photos only. Video container metadata (QuickTime ``creationdate``, GPS atoms,
duration/fps/codec) lives in the container and is out of scope for this
filesystem adapter; the osxphotos adapter gets those from the Photos database.
"""

from __future__ import annotations

import mimetypes
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

try:
    from PIL import Image, ExifTags

    _HAVE_PIL = True
except Exception:  # pragma: no cover
    _HAVE_PIL = False


# --------------------------------------------------------------------------- #
# Date helpers — ported 1:1 from capture-date.ts                              #
# --------------------------------------------------------------------------- #

_EXIF_DT_RE = re.compile(r"^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})")
_OFFSET_RE = re.compile(r"^([+-])(\d{2}):?(\d{2})$")
# IMG_20190704 / 2019-07-04 / 2019_07_04 — date only.
_FILENAME_DATE_RE = re.compile(
    r"(?:^|\D)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?=\D|$)"
)


def _is_real_date(y: int, mo: int, d: int) -> bool:
    try:
        datetime(y, mo, d)
        return True
    except ValueError:
        return False


def parse_exif_wallclock(value: str) -> Optional[Tuple[int, int, int, int, int, int]]:
    """Parse a naive EXIF datetime string into (Y, M, D, h, m, s) components.

    Deliberately component-based: a naive EXIF time is never passed through a
    timezone-aware parser (that would apply the host tz), matching the TS.
    """
    if not value:
        return None
    m = _EXIF_DT_RE.match(value.strip())
    if not m:
        return None
    y, mo, d, h, mi, s = (int(g) for g in m.groups())
    if not _is_real_date(y, mo, d):
        return None
    if not (0 <= h <= 23 and 0 <= mi <= 59 and 0 <= s <= 60):
        return None
    return y, mo, d, h, mi, s


def parse_tz_offset(offset: Optional[str]) -> Optional[int]:
    """EXIF offset string -> minutes east of UTC. 'Z' -> 0. Invalid -> None."""
    if not offset:
        return None
    s = offset.strip()
    if s in ("Z", "z"):
        return 0
    m = _OFFSET_RE.match(s)
    if not m:
        return None
    sign, hh, mm = m.group(1), int(m.group(2)), int(m.group(3))
    if hh > 14 or mm > 59:
        return None
    mins = hh * 60 + mm
    return -mins if sign == "-" else mins


def _instant_from_wallclock(
    y: int, mo: int, d: int, h: int, mi: int, s: int, offset_min: Optional[int]
) -> str:
    """UTC ISO instant for a wall-clock observed at ``offset_min`` (null => treat
    as UTC, deterministic). Format matches JS ``Date.toISOString()`` (``.000Z``).
    """
    dt = datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc) - timedelta(
        minutes=(offset_min or 0)
    )
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _local_date(y: int, mo: int, d: int) -> str:
    return f"{y:04d}-{mo:02d}-{d:02d}"


def _filename_date(name: str) -> Optional[Tuple[int, int, int]]:
    m = _FILENAME_DATE_RE.search(name)
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return (y, mo, d) if _is_real_date(y, mo, d) else None


class CaptureDate(dict):
    """Resolved capture date: taken_at / tz_offset / local_date / source / confidence."""


def resolve_capture_date(
    exif_datetime_original: Optional[str],
    exif_offset_time_original: Optional[str],
    filename: Optional[str],
    file_mtime_ms: Optional[int],
) -> CaptureDate:
    """Resolve the canonical capture date, descending trust order — a port of the
    photo/filename/mtime branches of ``resolveCaptureDate``. (manual / video /
    upload_fallback branches don't apply to a read-only filesystem index.)
    """
    # 1. Photo EXIF.
    wc = parse_exif_wallclock(exif_datetime_original) if exif_datetime_original else None
    if wc:
        y, mo, d, h, mi, s = wc
        offset = parse_tz_offset(exif_offset_time_original)
        if offset is not None:
            return CaptureDate(
                taken_at=_instant_from_wallclock(y, mo, d, h, mi, s, offset),
                tz_offset=offset,
                local_date=_local_date(y, mo, d),
                date_source="exif_offset",
                date_confidence="high",
            )
        return CaptureDate(
            taken_at=_instant_from_wallclock(y, mo, d, h, mi, s, None),
            tz_offset=None,
            local_date=_local_date(y, mo, d),
            date_source="exif",
            date_confidence="medium",
        )

    # 2. Filename date (date only -> noon so a bare day can't drift).
    if filename:
        fd = _filename_date(filename)
        if fd:
            y, mo, d = fd
            return CaptureDate(
                taken_at=_instant_from_wallclock(y, mo, d, 12, 0, 0, None),
                tz_offset=None,
                local_date=_local_date(y, mo, d),
                date_source="filename",
                date_confidence="low",
            )

    # 3. Filesystem mtime.
    if file_mtime_ms and file_mtime_ms > 0:
        dt = datetime.fromtimestamp(file_mtime_ms / 1000.0, tz=timezone.utc)
        return CaptureDate(
            taken_at=dt.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            tz_offset=None,
            local_date=_local_date(dt.year, dt.month, dt.day),
            date_source="file_mtime",
            date_confidence="low",
        )

    # 4. Nothing.
    return CaptureDate(
        taken_at=None,
        tz_offset=None,
        local_date=None,
        date_source=None,
        date_confidence=None,
    )


# --------------------------------------------------------------------------- #
# EXIF reading (Pillow)                                                        #
# --------------------------------------------------------------------------- #

_MIME_BY_FORMAT = {
    "JPEG": "image/jpeg",
    "MPO": "image/jpeg",  # multi-picture (Live Photo stills, some phones)
    "PNG": "image/png",
    "GIF": "image/gif",
    "WEBP": "image/webp",
    "TIFF": "image/tiff",
    "HEIF": "image/heic",
    "HEIC": "image/heic",
    "BMP": "image/bmp",
}


def _json_safe(v: Any) -> Any:
    """Coerce EXIF values (IFDRational, bytes, tuples, nested IFDs) to JSON types."""
    # IFDRational and other Fraction-likes expose numerator/denominator.
    if hasattr(v, "numerator") and hasattr(v, "denominator"):
        try:
            return float(v)
        except (ZeroDivisionError, ValueError):
            return f"{v.numerator}/{v.denominator}"
    if isinstance(v, bytes):
        try:
            return v.decode("utf-8", "replace").rstrip("\x00")
        except Exception:
            return v.hex()
    if isinstance(v, (list, tuple)):
        return [_json_safe(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _json_safe(val) for k, val in v.items()}
    if isinstance(v, (int, float, str, bool)) or v is None:
        return v
    return str(v)


def _dms_to_deg(dms: Any, ref: Any) -> Optional[float]:
    """Convert an EXIF GPS (degrees, minutes, seconds) rational triple + N/S/E/W
    ref to signed decimal degrees."""
    try:
        deg, minute, sec = (float(x) for x in dms)
    except (TypeError, ValueError):
        return None
    val = deg + minute / 60.0 + sec / 3600.0
    if isinstance(ref, bytes):
        ref = ref.decode("ascii", "ignore")
    if ref and str(ref).upper() in ("S", "W"):
        val = -val
    return val


def _num(v: Any) -> Optional[float]:
    try:
        f = float(v)
        return f if f == f and abs(f) != float("inf") else None
    except (TypeError, ValueError):
        return None


def _str(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, bytes):
        v = v.decode("utf-8", "replace")
    s = str(v).strip().rstrip("\x00").strip()
    return s or None


class PhotoMeta(dict):
    """Normalised per-file metadata + a verbatim ``raw`` dump."""


def extract_photo_meta(path: str) -> PhotoMeta:
    """Extract dimensions, mime, GPS, device, capture date and a raw EXIF dump.

    Read-only. Always returns a PhotoMeta; missing/corrupt EXIF yields ``None``
    fields rather than raising, mirroring the app's tolerant extractor.
    """
    meta = PhotoMeta(
        width=None,
        height=None,
        mime=None,
        original_filename=os.path.basename(path),
        gps_lat=None,
        gps_lng=None,
        gps_altitude=None,
        camera_make=None,
        camera_model=None,
        orientation=None,
        raw=None,
    )

    # Filesystem mtime (ms), used as a last-resort date and as a resume signature.
    try:
        st = os.stat(path)
        meta["_mtime_ms"] = int(st.st_mtime * 1000)
        meta["_size_bytes"] = int(st.st_size)
    except OSError:
        meta["_mtime_ms"] = None
        meta["_size_bytes"] = None

    exif_dt = None
    exif_offset = None

    if _HAVE_PIL:
        try:
            with Image.open(path) as im:
                meta["width"], meta["height"] = im.width, im.height
                meta["mime"] = _MIME_BY_FORMAT.get(
                    (im.format or "").upper()
                ) or mimetypes.guess_type(path)[0]

                exif = im.getexif()
                raw: Dict[str, Any] = {}
                if exif:
                    # IFD0 (Make/Model/Orientation/DateTime).
                    for tag_id, val in exif.items():
                        name = ExifTags.TAGS.get(tag_id, str(tag_id))
                        raw[name] = _json_safe(val)
                    meta["camera_make"] = _str(exif.get(0x010F))
                    meta["camera_model"] = _str(exif.get(0x0110))
                    meta["orientation"] = exif.get(0x0112)

                    # Exif sub-IFD (dates, offsets, lens, exposure).
                    try:
                        exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
                    except Exception:
                        exif_ifd = {}
                    for tag_id, val in (exif_ifd or {}).items():
                        name = ExifTags.TAGS.get(tag_id, str(tag_id))
                        raw[name] = _json_safe(val)
                    exif_dt = _str(exif_ifd.get(0x9003)) or _str(exif_ifd.get(0x9004))
                    exif_offset = _str(exif_ifd.get(0x9011)) or _str(exif_ifd.get(0x9012))

                    # GPS sub-IFD.
                    try:
                        gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo)
                    except Exception:
                        gps_ifd = {}
                    if gps_ifd:
                        graw = {
                            ExifTags.GPSTAGS.get(k, str(k)): _json_safe(v)
                            for k, v in gps_ifd.items()
                        }
                        raw["GPSInfo"] = graw
                        meta["gps_lat"] = _dms_to_deg(gps_ifd.get(2), gps_ifd.get(1))
                        meta["gps_lng"] = _dms_to_deg(gps_ifd.get(4), gps_ifd.get(3))
                        alt = _num(gps_ifd.get(6))
                        if alt is not None and gps_ifd.get(5) == 1:
                            alt = -alt  # below sea level
                        meta["gps_altitude"] = alt

                meta["raw"] = raw or None
        except Exception:
            # Unreadable/corrupt image — keep the null fields we already have.
            pass

    cap = resolve_capture_date(exif_dt, exif_offset, meta["original_filename"], meta["_mtime_ms"])
    meta.update(cap)
    return meta
