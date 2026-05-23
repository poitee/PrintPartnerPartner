"""CLI entry: render STL preview PNG in an isolated process (avoids VTK thread crashes)."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    from print_partner.logging_setup import configure_logging

    configure_logging()
    args = argv if argv is not None else sys.argv[1:]
    if len(args) < 3:
        logger.error("usage: preview_cli STL_PATH PNG_PATH ROLE [MESH_HEX]")
        return 2
    from print_partner.core.mesh_color import normalize_mesh_hex
    from print_partner.core.stl_preview_render import render_stl_preview_png

    mesh_hex = normalize_mesh_hex(args[3]) if len(args) > 3 and args[3] else None
    result = render_stl_preview_png(Path(args[0]), Path(args[1]), args[2], mesh_hex)
    if result.ok:
        sys.stdout.write(f"{result.points}\n")
        return 0
    logger.error("%s", result.error)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
