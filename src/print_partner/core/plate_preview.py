"""Group packed plate items by repository and folder for UI and manifests."""

from __future__ import annotations

from dataclasses import dataclass

from print_partner.core.export_3mf import object_display_name
from print_partner.core.parts_grouping import folder_key_from_relative_path
from print_partner.core.parts_tree import repo_name_from_source_layer
from print_partner.core.plate_packer import PlacedItem


@dataclass(frozen=True)
class PlateSourceGroup:
    repo: str
    folder: str
    part_names: list[str]


def group_plate_items_by_source(items: list[PlacedItem]) -> list[PlateSourceGroup]:
    """Group placed copies on one plate by repo and directory."""
    buckets: dict[tuple[str, str], list[str]] = {}
    used: set[str] = set()
    for item in items:
        part = item.copy.part
        repo = repo_name_from_source_layer(part.source_layer)
        folder = folder_key_from_relative_path(part.relative_path)
        name = object_display_name(part.filename, item.copy.unit, used)
        buckets.setdefault((repo, folder), []).append(name)
    keys = sorted(buckets.keys(), key=lambda k: (k[0].lower(), k[1].lower()))
    return [
        PlateSourceGroup(repo=repo, folder=folder, part_names=buckets[(repo, folder)])
        for repo, folder in keys
    ]
