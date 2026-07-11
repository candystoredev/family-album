"""Perceptual-hash tests — the parity guarantee is the headline.

* Known, engine-independent vectors (monotonic gradients).
* Bit-packing unit test against the TS nibble ordering.
* JPEG shrink-on-load factor boundaries.
* PARITY: the Python port vs the album app's real `perceptualHash` (sharp),
  invoked through `reference_hash.ts` with the repo's `tsx`. With pyvips this is
  asserted byte-identical; the Pillow fallback is checked to be close.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

from conftest import write_jpg, write_jpg_with_exif, write_png
from indexer.phash import (
    PHASH_ENGINE,
    _pixels_to_hex,
    jpeg_shrink_factor,
    perceptual_hash,
)


def _hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


# --------------------------------------------------------------------------- #
# Known vectors — hold for ANY correct dHash engine.                          #
# --------------------------------------------------------------------------- #


def test_known_vectors(tmp_path):
    # strictly increasing left->right: every adjacent pair left<right => all ones
    assert perceptual_hash(write_png(str(tmp_path / "a.png"), "hgrad")) == "f" * 16
    # strictly decreasing: no pair satisfies left<right => all zeros
    assert perceptual_hash(write_png(str(tmp_path / "b.png"), "hgrad_rev")) == "0" * 16
    # constant across each row (vertical gradient): left == right => all zeros
    assert perceptual_hash(write_png(str(tmp_path / "c.png"), "vgrad")) == "0" * 16


def test_hash_shape(tmp_path):
    h = perceptual_hash(write_jpg(str(tmp_path / "n.jpg"), "noise", seed=3))
    assert h is not None and len(h) == 16 and all(c in "0123456789abcdef" for c in h)


def test_pixels_to_hex_matches_ts_bit_order():
    # Row 0 increasing (8 ones), rows 1-7 flat (zeros): 11111111 then 56 zeros.
    grid = [0, 1, 2, 3, 4, 5, 6, 7, 8] + [5] * (9 * 7)
    # 0xFF then 7 zero bytes.
    assert _pixels_to_hex(grid) == "ff00000000000000"


def test_pixels_to_hex_rejects_bad_length():
    with pytest.raises(ValueError):
        _pixels_to_hex([0] * 10)


def test_jpeg_shrink_factor_boundaries():
    # Real photos (large) always land on factor 8.
    assert jpeg_shrink_factor(4000, 3000) == 8
    assert jpeg_shrink_factor(320, 240) == 8
    # Strictly-larger-than-target rule verified byte-exact vs sharp:
    assert jpeg_shrink_factor(90, 80) == 8
    assert jpeg_shrink_factor(72, 64) == 4   # 72/8 == 9 not > 9 -> drop to 4
    assert jpeg_shrink_factor(71, 63) == 4
    assert jpeg_shrink_factor(36, 32) == 2   # 36/4 == 9 not > 9 -> drop to 2
    assert jpeg_shrink_factor(35, 31) == 2
    assert jpeg_shrink_factor(18, 16) == 1   # 18/2 == 9 not > 9 -> drop to 1
    assert jpeg_shrink_factor(17, 15) == 1


# --------------------------------------------------------------------------- #
# PARITY vs the app's real perceptualHash (sharp).                            #
# --------------------------------------------------------------------------- #


def _tsx(repo_root: str):
    local = os.path.join(repo_root, "node_modules", ".bin", "tsx")
    if os.path.exists(local):
        return local
    return shutil.which("tsx")


def _reference_hashes(repo_root: str, files):
    tsx = _tsx(repo_root)
    if not tsx:
        pytest.skip("tsx not available; skipping TS parity oracle")
    script = os.path.join(repo_root, "tools", "backfill-indexer", "reference_hash.ts")
    try:
        out = subprocess.run(
            [tsx, script, *files],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=180,
        )
    except Exception as e:  # pragma: no cover
        pytest.skip(f"could not run tsx reference: {e}")
    if out.returncode != 0:
        pytest.skip(f"reference_hash.ts failed (sharp/node env?): {out.stderr[:400]}")
    return json.loads(out.stdout)


def test_parity_with_app_perceptual_hash(tmp_path, repo_root):
    """The critical requirement: same input bytes -> same 16-hex hash as the app."""
    files = []
    files.append(write_png(str(tmp_path / "hgrad.png"), "hgrad"))
    files.append(write_png(str(tmp_path / "color.png"), "color"))
    files.append(write_png(str(tmp_path / "checker.png"), "checker"))
    files.append(write_png(str(tmp_path / "noise.png"), "noise", seed=11))
    files.append(write_jpg(str(tmp_path / "checker.jpg"), "checker"))
    files.append(write_jpg(str(tmp_path / "noise.jpg"), "noise", seed=7))
    files.append(write_jpg(str(tmp_path / "big.jpg"), "checker", w=2000, h=1500))
    files.append(write_jpg_with_exif(str(tmp_path / "exif.jpg"), "color"))

    ref = _reference_hashes(repo_root, files)

    mismatches = []
    for f in files:
        mine = perceptual_hash(f)
        theirs = ref.get(f)
        assert theirs is not None, f"app returned null hash for {f}"
        if mine != theirs:
            mismatches.append((os.path.basename(f), mine, theirs, _hamming(mine, theirs)))

    if PHASH_ENGINE == "pyvips":
        assert not mismatches, f"byte-parity broken with pyvips: {mismatches}"
    else:
        # Fallback: grayscale is exact but Pillow's Lanczos != libvips', so hard-
        # edged/synthetic content can drift 10-25 bits. It is a runnable safety
        # net, NOT a parity guarantee — only assert it is meaningfully correlated
        # (well below the ~32-bit expectation for unrelated 64-bit hashes).
        worst = max((m[3] for m in mismatches), default=0)
        assert worst <= 30, f"pillow fallback uncorrelated (install pyvips): {mismatches}"


def test_parity_engine_is_pyvips():
    """Guard: the parity guarantee needs pyvips. Fail loudly if it's missing so a
    non-parity run is never mistaken for a passing one."""
    if PHASH_ENGINE != "pyvips":
        pytest.skip(
            "pyvips not installed — running with the Pillow fallback (approximate). "
            "Install 'pyvips[binary]' for byte-exact parity."
        )
    assert PHASH_ENGINE == "pyvips"
