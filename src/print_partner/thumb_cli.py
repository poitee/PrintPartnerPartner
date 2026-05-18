"""CLI: generate one STL thumbnail in an isolated process (avoids VTK + Qt crashes)."""

from __future__ import annotations

import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) < 3:
        print("usage: thumb_cli STL_PATH PNG_PATH ROLE [MESH_HEX]", file=sys.stderr)
        return 2
    from print_partner.core.thumbnails import generate_thumbnail

    mesh_hex = args[3] if len(args) > 3 and args[3] else None
    ok = generate_thumbnail(Path(args[0]), Path(args[1]), args[2], mesh_hex)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
