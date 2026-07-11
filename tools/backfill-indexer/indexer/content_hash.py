"""Content hash — SHA-256 of the original file bytes, lowercase hex.

Matches the album's ``sha256Hex`` (``src/lib/media/extract.ts``), which digests
the *original* bytes before compression. Tool B uses this for exact-duplicate
detection and to corroborate perceptual matches. Streamed in chunks so hashing a
large original never loads it whole into memory (read-only).
"""

from __future__ import annotations

import hashlib
from typing import Optional

_CHUNK = 1 << 20  # 1 MiB


def sha256_hex(path: str) -> Optional[str]:
    """SHA-256 of the file at ``path`` as lowercase hex, or ``None`` on error."""
    h = hashlib.sha256()
    try:
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(_CHUNK), b""):
                h.update(chunk)
    except OSError:
        return None
    return h.hexdigest()


def sha256_hex_bytes(buf: bytes) -> str:
    """SHA-256 of an in-memory buffer as lowercase hex."""
    return hashlib.sha256(buf).hexdigest()
