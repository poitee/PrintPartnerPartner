"""STL filename/path parsers ported from stl-manifest-generator."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from pathlib import PurePosixPath


class PartRole(str, Enum):
    PRIMARY = "primary"
    ACCENT = "accent"
    CLEAR = "clear"
    OPAQUE = "opaque"


ROLE_MARKERS = {
    "[a]": PartRole.ACCENT,
    "[c]": PartRole.CLEAR,
    "[o]": PartRole.OPAQUE,
}

QUANTITY_RE = re.compile(r"[ _]x([0-9]+)\.stl$", re.IGNORECASE)
ROLE_PREFIX_RE = re.compile(r"^\[[aco]\]", re.IGNORECASE)


@dataclass(frozen=True)
class ParsedPart:
    role: PartRole
    quantity: int
    part_slug: str
    filename: str


def _check_role_in_text(text: str) -> PartRole | None:
    lower = text.lower()
    for marker, role in ROLE_MARKERS.items():
        if marker in lower:
            return role
    return None


def parse_role(path_or_name: str) -> PartRole:
    """Detect role from path segments and filename ([a]/[c]/[o])."""
    posix = PurePosixPath(path_or_name.replace("\\", "/"))
    for segment in (*posix.parent.parts, posix.name):
        found = _check_role_in_text(segment)
        if found is not None:
            return found
    return PartRole.PRIMARY


def parse_quantity(filename: str) -> int:
    m = QUANTITY_RE.search(filename)
    if m:
        return max(1, int(m.group(1)))
    return 1


def parse_part_slug(filename: str) -> str:
    """Basename stripped of role prefixes and _xN quantity suffix."""
    name = PurePosixPath(filename).name
    if name.lower().endswith(".stl"):
        stem = name[:-4]
    else:
        stem = name
    stem = ROLE_PREFIX_RE.sub("", stem)
    stem = re.sub(r"[ _]x[0-9]+$", "", stem, flags=re.IGNORECASE)
    return stem or name


def parse_stl_path(relative_path: str) -> ParsedPart:
    filename = PurePosixPath(relative_path.replace("\\", "/")).name
    return ParsedPart(
        role=parse_role(relative_path),
        quantity=parse_quantity(filename),
        part_slug=parse_part_slug(filename),
        filename=filename,
    )
