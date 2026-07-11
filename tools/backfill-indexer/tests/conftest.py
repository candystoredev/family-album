"""Shared test fixtures: deterministic image generation (+ EXIF) and repo paths.

All images are generated on the fly so the suite is self-contained and
reproducible; no binary fixtures are checked in.
"""

from __future__ import annotations

import os
import sys

import pytest

# Make the tool package importable when pytest runs from anywhere.
TOOL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(os.path.dirname(TOOL_DIR))
sys.path.insert(0, TOOL_DIR)

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402


def make_rgb(kind: str, w: int = 320, h: int = 240, seed: int = 0) -> Image.Image:
    """Deterministic RGB test images with distinct dHash signatures."""
    if kind == "hgrad":  # strictly increasing left->right => dHash all-ones
        x = np.linspace(0, 255, w)
        a = np.repeat(x[None, :], h, axis=0)
        arr = np.stack([a, a, a], -1)
    elif kind == "hgrad_rev":  # strictly decreasing left->right => all-zeros
        x = np.linspace(255, 0, w)
        a = np.repeat(x[None, :], h, axis=0)
        arr = np.stack([a, a, a], -1)
    elif kind == "vgrad":  # constant across each row => all-zeros (left == right)
        y = np.linspace(0, 255, h)
        a = np.repeat(y[:, None], w, axis=1)
        arr = np.stack([a, a, a], -1)
    elif kind == "color":  # channels differ => exercises the grayscale formula
        r = np.repeat(np.linspace(0, 255, w)[None, :], h, axis=0)
        g = np.repeat(np.linspace(0, 255, h)[:, None], w, axis=1)
        b = np.full((h, w), 128.0)
        arr = np.stack([r, g, b], -1)
    elif kind == "checker":
        arr = np.zeros((h, w, 3))
        for i in range(0, h, 20):
            for j in range(0, w, 20):
                v = ((i // 20 + j // 20) % 2) * 200 + 30
                arr[i : i + 20, j : j + 20] = [v, 255 - v, (v + 80) % 255]
    elif kind == "noise":
        from PIL import ImageFilter

        rng = np.random.default_rng(seed)
        n = rng.integers(0, 256, (h, w, 3)).astype("uint8")
        return Image.fromarray(n, "RGB").filter(ImageFilter.GaussianBlur(3))
    else:
        raise ValueError(kind)
    return Image.fromarray(arr.astype("uint8"), "RGB")


def write_png(path: str, kind: str, **kw) -> str:
    make_rgb(kind, **kw).save(path)
    return path


def write_jpg(path: str, kind: str, quality: int = 90, **kw) -> str:
    make_rgb(kind, **kw).convert("RGB").save(path, "JPEG", quality=quality)
    return path


def write_jpg_with_exif(
    path: str,
    kind: str = "checker",
    dt: str = "2019:07:04 15:30:00",
    offset: str = "+02:00",
    make: str = "TestCam",
    model: str = "Model X",
    lat_dms=((51, 1), (30, 1), (0, 1)),
    lat_ref: bytes = b"N",
    lng_dms=((0, 1), (7, 1), (0, 1)),
    lng_ref: bytes = b"W",
    **kw,
) -> str:
    """Write a JPEG with a known EXIF block (via piexif) for extraction tests."""
    import piexif

    zeroth = {
        piexif.ImageIFD.Make: make.encode(),
        piexif.ImageIFD.Model: model.encode(),
        piexif.ImageIFD.Orientation: 1,
    }
    exif_ifd = {
        piexif.ExifIFD.DateTimeOriginal: dt.encode(),
        piexif.ExifIFD.FNumber: (28, 10),
        piexif.ExifIFD.ISOSpeedRatings: 200,
        piexif.ExifIFD.FocalLength: (50, 1),
        piexif.ExifIFD.ExposureTime: (1, 250),
    }
    if offset:
        exif_ifd[piexif.ExifIFD.OffsetTimeOriginal] = offset.encode()
    gps = {}
    if lat_dms is not None:
        gps = {
            piexif.GPSIFD.GPSLatitudeRef: lat_ref,
            piexif.GPSIFD.GPSLatitude: lat_dms,
            piexif.GPSIFD.GPSLongitudeRef: lng_ref,
            piexif.GPSIFD.GPSLongitude: lng_dms,
            piexif.GPSIFD.GPSAltitudeRef: 0,
            piexif.GPSIFD.GPSAltitude: (35, 1),
        }
    exif_bytes = piexif.dump({"0th": zeroth, "Exif": exif_ifd, "GPS": gps})
    make_rgb(kind, **kw).convert("RGB").save(path, "JPEG", quality=92, exif=exif_bytes)
    return path


@pytest.fixture
def repo_root() -> str:
    return REPO_ROOT


@pytest.fixture
def tool_dir() -> str:
    return TOOL_DIR
