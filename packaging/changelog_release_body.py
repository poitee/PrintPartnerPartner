#!/usr/bin/env python3
"""Extract a CHANGELOG section for a GitHub Release body."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def extract_changelog_body(version: str, changelog_path: Path | None = None) -> str | None:
    path = changelog_path or (ROOT / "CHANGELOG.md")
    text = path.read_text(encoding="utf-8")
    v = version.lstrip("v")
    header_patterns = (
        rf"^##\s*\[{re.escape(v)}\][^\n]*\n",
        rf"^##\s*{re.escape(v)}\b[^\n]*\n",
    )
    start = -1
    for pattern in header_patterns:
        match = re.search(pattern, text, re.MULTILINE)
        if match:
            start = match.end()
            break
    if start < 0:
        return None

    rest = text[start:]
    next_header = re.search(r"^##\s+", rest, re.MULTILINE)
    section = rest[: next_header.start()] if next_header else rest
    body = section.strip()
    return body or None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="Release version (e.g. 0.2.3)")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Write body to file (for GITHUB_OUTPUT body_path)",
    )
    args = parser.parse_args(argv)

    body = extract_changelog_body(args.version.lstrip("v"))
    if not body:
        print(f"No CHANGELOG section for {args.version}", file=sys.stderr)
        return 1

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(body + "\n", encoding="utf-8")
    else:
        print(body)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
