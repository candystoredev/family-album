"""Perceptual hash (dHash) — a faithful Python port of the album app's
``perceptualHash`` in ``src/lib/media/image-hash.ts``.

The album computes ``phash`` server-side with **sharp** (a wrapper around
libvips):

    sharp(buf).greyscale().resize(9, 8, { fit: "fill" }).raw()

then, for each of the 8 rows, emits one bit per adjacent column pair
(left < right) — 8 rows x 8 comparisons = 64 bits -> 16 hex chars, packed
most-significant-bit first.

Tool B (the Matcher) will re-hash the album's stored thumbnails and match them
against the hashes this Indexer computes from the local originals. That only
works if **the same input bytes produce the same 16-hex string on both sides**.
dHash is resolution-invariant by design, which is why an original and its
re-encoded thumbnail land on the same (or a very close) hash — but the two
implementations must agree on the *algorithm* down to the pixel.

Parity strategy
---------------
The primitive image ops (JPEG decode, greyscale, resize) are where two imaging
stacks silently disagree — different grayscale weights, different resize kernels,
different rounding. Rather than approximate sharp with a *different* engine, the
primary path uses **pyvips**, the Python binding for the *same* libvips C library
that sharp wraps. The ``pyvips[binary]`` wheel bundles libvips, so this stays a
plain ``pip install`` with no system packages. Reproducing sharp's pipeline on
that engine is byte-identical (verified in ``tests/test_phash.py`` against the
app's real TypeScript ``perceptualHash`` — maxbyte diff 0 across JPEG/PNG and
JPEG shrink-on-load boundary sizes).

Two sharp behaviours had to be reproduced exactly:

* **Greyscale is linear-light Rec.709 luminance**, not the usual Rec.601 luma
  that ``PIL.Image.convert("L")`` uses. libvips ``colourspace("b-w")`` un-gammas
  sRGB to linear light, takes ``0.2126 R + 0.7152 G + 0.0722 B``, then re-applies
  the sRGB gamma. (Pure red -> 127, green -> 220, blue -> 76, vs Rec.601's
  76/150/29.)
* **JPEG shrink-on-load.** For JPEG input, sharp asks libjpeg to decode at a
  1/2, 1/4 or 1/8 DCT scale before the residual Lanczos resize. It picks the
  largest factor N in {8,4,2,1} for which the decoded image is still strictly
  larger than the 9x8 target (``W/N > 9 and H/N > 8``), so a genuine residual
  reduce remains. Skipping this makes large-JPEG hashes diverge by ~20+ bits.
  Non-JPEG formats are decoded whole (no DCT scaling), matching sharp.

A Pillow-only fallback (``_phash_pillow``) is provided for environments without
pyvips. It matches the greyscale exactly but uses Pillow's Lanczos resize, so it
is *close* but not guaranteed byte-identical (a few bits on hard-edged content).
It emits a warning and records ``phash_engine='pillow-fallback'`` so a run
without true parity is never silent. Install pyvips for the guarantee.
"""

from __future__ import annotations

import io
import math
import warnings
from typing import Optional

# Target grid: downscale to 9x8 greyscale, compare 8 adjacent pairs per row.
_W = 9
_H = 8

# ---- engine detection -------------------------------------------------------

try:  # primary, parity-exact engine
    import pyvips  # type: ignore

    _HAVE_PYVIPS = True
except Exception:  # pragma: no cover - exercised only where pyvips is absent
    _HAVE_PYVIPS = False

PHASH_ENGINE = "pyvips" if _HAVE_PYVIPS else "pillow-fallback"


def _is_jpeg(buf: bytes) -> bool:
    return len(buf) >= 3 and buf[0] == 0xFF and buf[1] == 0xD8 and buf[2] == 0xFF


def jpeg_shrink_factor(width: int, height: int, tw: int = _W, th: int = _H) -> int:
    """sharp's JPEG shrink-on-load factor for a WxH image scaling to ``tw`` x ``th``.

    Largest N in {8,4,2,1} such that the DCT-scaled image is still strictly
    larger than the target in both axes (so libvips keeps a real residual
    reduce). Verified byte-exact against sharp at the 72x64 / 36x32 / 18x16
    boundaries.
    """
    for n in (8, 4, 2, 1):
        if width / n > tw and height / n > th:
            return n
    return 1


# ---- bit packing ------------------------------------------------------------


def _pixels_to_hex(px: "list[int] | bytes") -> str:
    """Pack a row-major 8x9 greyscale grid into the app's 16-hex dHash.

    For each of 8 rows, emit one bit per adjacent column pair (left < right),
    accumulated most-significant-bit first — identical to the TS reference.
    """
    if len(px) != _W * _H:
        raise ValueError(f"expected {_W * _H} greyscale samples, got {len(px)}")
    bits = 0
    for y in range(_H):
        row = y * _W
        for x in range(_W - 1):
            i = row + x
            bits = (bits << 1) | (1 if px[i] < px[i + 1] else 0)
    return f"{bits:016x}"


# ---- pyvips path (byte-exact) ----------------------------------------------


def _grid_pyvips(buf: bytes) -> list[int]:
    # Header-only read to get dimensions (cheap; no full decode).
    header = pyvips.Image.new_from_buffer(buf, "")
    w, h = header.width, header.height

    if _is_jpeg(buf):
        n = jpeg_shrink_factor(w, h)
        img = (
            pyvips.Image.jpegload_buffer(buf, shrink=n)
            if n > 1
            else pyvips.Image.new_from_buffer(buf, "")
        )
    else:
        img = pyvips.Image.new_from_buffer(buf, "")

    # greyscale (linear-light Rec.709) -> resize to exactly 9x8 (Lanczos3).
    g = img.colourspace("b-w").resize(_W / img.width, vscale=_H / img.height)
    if g.bands > 1:  # some inputs (e.g. with alpha) keep extra bands
        g = g[0]
    raw = g.cast("uchar").write_to_memory()
    return list(raw[: _W * _H])


# ---- Pillow fallback (close, not byte-exact) --------------------------------


def _grid_pillow(buf: bytes) -> list[int]:
    from PIL import Image  # local import so pyvips-only installs don't need PIL here

    try:
        import numpy as np

        _HAVE_NP = True
    except Exception:
        _HAVE_NP = False

    im = Image.open(io.BytesIO(buf))
    im = im.convert("RGB")

    if _HAVE_NP:
        a = np.asarray(im, dtype=np.float64) / 255.0

        def to_lin(c):
            return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

        y = 0.2126 * to_lin(a[..., 0]) + 0.7152 * to_lin(a[..., 1]) + 0.0722 * to_lin(a[..., 2])
        y = np.where(y <= 0.0031308, 12.92 * y, 1.055 * (y ** (1 / 2.4)) - 0.055)
        gray = Image.fromarray(np.clip(np.rint(y * 255), 0, 255).astype("uint8"), "L")
    else:  # pure-Python linear-light Rec.709, slower but dependency-free
        def to_lin(c: float) -> float:
            c /= 255.0
            return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

        def to_srgb(y: float) -> int:
            y = 12.92 * y if y <= 0.0031308 else 1.055 * (y ** (1 / 2.4)) - 0.055
            return max(0, min(255, round(y * 255)))

        px = list(im.getdata())
        gray = Image.new("L", im.size)
        gray.putdata(
            [to_srgb(0.2126 * to_lin(r) + 0.7152 * to_lin(g) + 0.0722 * to_lin(b)) for r, g, b in px]
        )

    small = gray.resize((_W, _H), Image.LANCZOS)
    return list(small.getdata())


# ---- public API -------------------------------------------------------------


def perceptual_hash_bytes(buf: bytes) -> Optional[str]:
    """dHash of raw image bytes, as 16 lowercase hex chars. ``None`` on failure.

    Mirrors the app's ``perceptualHash`` contract (returns null rather than
    raising on unreadable input).
    """
    try:
        grid = _grid_pyvips(buf) if _HAVE_PYVIPS else _grid_pillow(buf)
        return _pixels_to_hex(grid)
    except Exception:
        return None


def perceptual_hash(path: str) -> Optional[str]:
    """dHash of the image at ``path`` (read-only). ``None`` on failure."""
    try:
        with open(path, "rb") as fh:
            buf = fh.read()
    except OSError:
        return None
    return perceptual_hash_bytes(buf)


if not _HAVE_PYVIPS:  # surface the parity caveat once, loudly.
    warnings.warn(
        "pyvips not installed: perceptual hashes use the Pillow fallback and are "
        "NOT guaranteed byte-identical to the album app. Install 'pyvips[binary]' "
        "for the parity guarantee the backfill matcher relies on.",
        RuntimeWarning,
        stacklevel=2,
    )
