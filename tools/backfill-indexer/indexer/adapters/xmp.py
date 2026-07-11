"""Lightroom / Adobe XMP sidecar adapter (LIGHT SCAFFOLD).

Adobe tools store edits and cataloguing next to (or inside) the image as XMP:
ratings (``xmp:Rating``), keywords/subjects (``dc:subject``), captions
(``dc:description``), title, and sometimes an overriding date
(``photoshop:DateCreated``) or GPS. For RAW/DNG workflows the XMP is a separate
``<image>.xmp`` file; for JPEGs it is often embedded (Pillow can surface that as
``APP1``), which this scaffold does not yet read.

Status: sidecar discovery + a dependency-free XMP field parse are implemented for
the common ``.xmp`` shape; embedded XMP and the full RDF/attribute-vs-element
variety are TODO. Kept dependency-free (regex over the XML) so the tool needs no
XML/RDF library.
"""

from __future__ import annotations

import os
import re
from typing import Any, Callable, Dict, Iterator, Optional

from .filesystem import iter_media_files

SOURCE_KIND = "xmp"

# Minimal, tolerant field extractors. A real implementation should use a proper
# RDF/XMP parser; these cover the common Lightroom-written element/attribute forms.
_RATING_RE = re.compile(r'xmp:Rating[>="\s]+(\d)')
_DATE_RE = re.compile(r"photoshop:DateCreated[>=\"\s]+([0-9T:\-+.]+)")
_SUBJECT_RE = re.compile(r"<rdf:li[^>]*>([^<]+)</rdf:li>")
_DESC_RE = re.compile(r"<dc:description>.*?<rdf:li[^>]*>([^<]+)</rdf:li>", re.DOTALL)


def _find_sidecar(image_path: str) -> Optional[str]:
    """Find the ``.xmp`` sidecar for an image (``photo.dng`` -> ``photo.xmp`` or
    ``photo.dng.xmp``)."""
    base, _ = os.path.splitext(image_path)
    for c in (base + ".xmp", image_path + ".xmp"):
        if os.path.isfile(c):
            return c
    return None


def parse_sidecar(sidecar_path: str) -> Dict[str, Any]:
    """Parse an XMP sidecar into overlay fields + the raw XMP text."""
    with open(sidecar_path, "r", encoding="utf-8", errors="replace") as fh:
        text = fh.read()

    out: Dict[str, Any] = {"raw": text}
    m = _RATING_RE.search(text)
    if m:
        out["rating"] = int(m.group(1))
    m = _DATE_RE.search(text)
    if m:
        out["date_created"] = m.group(1)  # TODO: normalise to taken_at/local_date
    subjects = _SUBJECT_RE.findall(text)
    if subjects:
        out["keywords"] = [s.strip() for s in subjects if s.strip()]
    m = _DESC_RE.search(text)
    if m:
        out["caption"] = m.group(1).strip()
    return out


def iter_records(
    root: str,
    build_file_record: Callable[..., Dict[str, Any]],
) -> Iterator[Dict[str, Any]]:
    """Yield an index row per image under ``root``, overlaying its ``.xmp`` sidecar
    (ratings/keywords/caption into ``raw_metadata.xmp``)."""
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
            extra_raw={"xmp": overlay} if overlay else None,
        )
        # TODO: when overlay has a usable date_created, map it to taken_at/local_date.
        yield record
