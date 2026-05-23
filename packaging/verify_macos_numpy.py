#!/usr/bin/env python3
"""Verify frozen macOS bundle NumPy extension targets supported macOS versions."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def _find_umath_so(app_root: Path) -> Path | None:
    frameworks = app_root / "Contents" / "Frameworks"
    if not frameworks.is_dir():
        return None
    # NumPy 1.x: numpy/core/_multiarray_umath*.so
    for pattern in (
        "numpy/core/_multiarray_umath*.so",
        "numpy/_core/_multiarray_umath*.so",
    ):
        matches = list(frameworks.glob(pattern))
        if matches:
            return matches[0]
    return None


def _min_os_version(so_path: Path) -> str | None:
    try:
        out = subprocess.check_output(
            ["otool", "-l", str(so_path)],
            text=True,
            stderr=subprocess.STDOUT,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    for line in out.splitlines():
        stripped = line.strip()
        if stripped.startswith("minos "):
            return stripped.split()[-1]
    return None


def main() -> int:
    if sys.platform != "darwin":
        print("skip: not macOS")
        return 0

    root = Path(__file__).resolve().parent.parent
    app = root / "dist" / "Print Partner.app"
    if not app.is_dir():
        print(f"ERROR: missing {app}", file=sys.stderr)
        return 1

    so = _find_umath_so(app)
    if so is None:
        print("ERROR: NumPy _multiarray_umath not found in bundle", file=sys.stderr)
        return 1

    ver = _min_os_version(so)
    print(f"NumPy extension: {so.name}")
    print(f"LC_BUILD_VERSION min OS: {ver or 'unknown'}")

    if ver:
        major = float(ver.split(".")[0])
        if major >= 14:
            print(
                "ERROR: extension requires macOS 14+ (incompatible with Option B target 12+)",
                file=sys.stderr,
            )
            return 1
        if major > 12:
            print(f"WARN: min OS {ver} — app targets macOS 12+; friend on 12.x should still work")

    print(f"OK: NumPy extension min OS {ver or 'unknown'} (compatible with macOS 12+)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
