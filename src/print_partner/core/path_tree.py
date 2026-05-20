"""Build nested directory trees from relative file paths."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class PathTreeNode:
    """Directory node: ``path`` is the full relative directory ('' for repo root)."""

    name: str
    path: str
    subdirs: dict[str, PathTreeNode] = field(default_factory=dict)
    files: list[str] = field(default_factory=list)


def iter_path_segments(relative_path: str) -> tuple[list[str], str]:
    """Return directory segments and filename for a posix-style relative path."""
    normalized = relative_path.replace("\\", "/").strip("/")
    if not normalized:
        return [], ""
    parts = normalized.split("/")
    if len(parts) == 1:
        return [], parts[0]
    return parts[:-1], parts[-1]


def ensure_subdir(parent: PathTreeNode, segment: str) -> PathTreeNode:
    path = f"{parent.path}/{segment}" if parent.path else segment
    if segment not in parent.subdirs:
        parent.subdirs[segment] = PathTreeNode(name=segment, path=path)
    return parent.subdirs[segment]


def build_path_tree(relative_paths: list[str]) -> PathTreeNode:
    """Nest relative paths into a directory tree (files stored on their parent folder node)."""
    root = PathTreeNode(name="", path="")
    for rel in relative_paths:
        dir_parts, _filename = iter_path_segments(rel)
        parent = root
        for seg in dir_parts:
            parent = ensure_subdir(parent, seg)
        parent.files.append(rel)
    return root
