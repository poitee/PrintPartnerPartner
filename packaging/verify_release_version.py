#!/usr/bin/env python3
"""Verify package version and CHANGELOG match a release tag or dispatch version."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _read_pyproject_version() -> str:
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r'^version\s*=\s*"([^"]+)"\s*$', text, re.MULTILINE)
    if not match:
        raise SystemExit("Could not find version in pyproject.toml")
    return match.group(1)


def _read_package_version() -> str:
    init = ROOT / "src" / "print_partner" / "__init__.py"
    text = init.read_text(encoding="utf-8")
    match = re.search(r'^__version__\s*=\s*"([^"]+)"\s*$', text, re.MULTILINE)
    if not match:
        raise SystemExit("Could not find __version__ in print_partner/__init__.py")
    return match.group(1)


def _changelog_has_version(changelog: str, version: str) -> bool:
    patterns = (
        rf"^##\s*\[{re.escape(version)}\]",
        rf"^##\s*{re.escape(version)}\b",
    )
    for pattern in patterns:
        if re.search(pattern, changelog, re.MULTILINE):
            return True
    return False


def normalize_version(raw: str) -> str:
    v = raw.strip()
    if v.startswith("v"):
        v = v[1:]
    if not re.fullmatch(r"\d+\.\d+\.\d+(-[\w.]+)?", v):
        raise SystemExit(f"Invalid version '{raw}' (expected semver like 0.2.3)")
    return v


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "version",
        nargs="?",
        help="Release version (e.g. 0.2.3 or v0.2.3). Defaults to GITHUB_REF_NAME.",
    )
    args = parser.parse_args(argv)

    import os

    raw = args.version or os.environ.get("GITHUB_REF_NAME", "")
    if not raw:
        print("version argument or GITHUB_REF_NAME required", file=sys.stderr)
        return 1

    version = normalize_version(raw)
    pyproject_v = _read_pyproject_version()
    package_v = _read_package_version()
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")

    errors: list[str] = []
    if pyproject_v != version:
        errors.append(f"pyproject.toml version is {pyproject_v}, expected {version}")
    if package_v != version:
        errors.append(f"print_partner.__version__ is {package_v}, expected {version}")
    if not _changelog_has_version(changelog, version):
        errors.append(f"CHANGELOG.md has no section for {version} (## [{version}] ...)")

    if errors:
        print(f"Release version check failed for v{version}:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        print(
            "\nBump pyproject.toml, src/print_partner/__init__.py, and CHANGELOG.md on main first.",
            file=sys.stderr,
        )
        return 1

    print(f"Release version v{version} matches package and CHANGELOG.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
