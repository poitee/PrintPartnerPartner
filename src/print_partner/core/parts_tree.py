"""Pure Python repo → directory → part tree for curation UI."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from print_partner.core.parts_grouping import (
    ROOT_FOLDER,
    filter_parts,
    folder_key_from_relative_path,
    folder_scan_order,
    order_folders,
    part_matches_query,
    sort_parts,
)
from print_partner.core.profile_parts_adapter import display_dict_to_scanned, filter_profile_dicts
from print_partner.core.scanner import ScannedPart

NodeKind = Literal["repo", "folder", "part"]
Tristate = Literal["checked", "unchecked", "partial"]


@dataclass(frozen=True)
class PartsTreeCounts:
    total: int
    included: int
    printed: int


@dataclass
class PartsTreeNode:
    kind: NodeKind
    key: str
    label: str
    repo: str
    folder_path: str
    children: list[PartsTreeNode] = field(default_factory=list)
    counts: PartsTreeCounts = field(default_factory=lambda: PartsTreeCounts(0, 0, 0))
    profile_row: dict | None = None
    scanned: ScannedPart | None = None


def repo_name_from_source_layer(source_layer: str) -> str:
    if ":" in source_layer:
        return source_layer.split(":", 1)[1]
    return source_layer or "unknown"


def folder_label(folder_path: str) -> str:
    return ROOT_FOLDER if not folder_path or folder_path == "." else folder_path


def folder_node_key(repo: str, folder_path: str) -> str:
    return f"{repo}|{folder_path}"


def rollup_tristate(total: int, included: int) -> Tristate:
    if total <= 0:
        return "unchecked"
    if included <= 0:
        return "unchecked"
    if included >= total:
        return "checked"
    return "partial"


def merge_tristates(states: list[Tristate]) -> Tristate:
    if not states:
        return "unchecked"
    if all(s == "checked" for s in states):
        return "checked"
    if all(s == "unchecked" for s in states):
        return "unchecked"
    return "partial"


def _counts_for_part_profile(row: dict, included_ids: set[int]) -> PartsTreeCounts:
    qty = max(1, row.get("quantity_effective", 1))
    printed = min(row.get("printed_count", 0), qty)
    if printed >= qty:
        printed_flag = 1
    else:
        printed_flag = 0
    inc = 1 if row["id"] in included_ids else 0
    return PartsTreeCounts(total=1, included=inc, printed=printed_flag)


def _counts_for_part_wizard(part: ScannedPart, included_keys: set[str]) -> PartsTreeCounts:
    inc = 1 if part.match_key in included_keys else 0
    return PartsTreeCounts(total=1, included=inc, printed=0)


def _sum_counts(nodes: list[PartsTreeNode]) -> PartsTreeCounts:
    total = sum(n.counts.total for n in nodes)
    included = sum(n.counts.included for n in nodes)
    printed = sum(n.counts.printed for n in nodes)
    return PartsTreeCounts(total=total, included=included, printed=printed)


def _format_folder_label(folder_path: str, counts: PartsTreeCounts) -> str:
    name = folder_label(folder_path)
    return f"{name} ({counts.total} parts, {counts.included} included)"


def _format_repo_label(repo: str, counts: PartsTreeCounts) -> str:
    return f"{repo} ({counts.total} parts, {counts.included} included)"


def _visible_profile_rows(
    all_rows: list[dict],
    *,
    query: str,
    hide_printed: bool,
) -> list[dict]:
    text_filtered = filter_profile_dicts(all_rows, query)
    text_ids = {r["id"] for r in text_filtered}
    result: list[dict] = []
    for row in all_rows:
        if row["id"] not in text_ids:
            continue
        if hide_printed:
            qty = max(1, row.get("quantity_effective", 1))
            if row.get("printed_count", 0) >= qty:
                continue
        result.append(row)
    return result


def build_profile_parts_tree(
    all_rows: list[dict],
    *,
    included_part_ids: set[int],
    query: str = "",
    hide_printed: bool = False,
    sort_by_name: bool = True,
    pinned_folders: list[str] | None = None,
    scan_order: dict[str, int] | None = None,
    folder_scan_order_list: list[str] | None = None,
) -> list[PartsTreeNode]:
    visible = _visible_profile_rows(all_rows, query=query, hide_printed=hide_printed)
    pinned = pinned_folders or []
    scan_order = scan_order or {}
    folder_scan_order_list = folder_scan_order_list or folder_scan_order(
        [display_dict_to_scanned(r) for r in all_rows]
    )

    by_repo: dict[str, dict[str, list[dict]]] = {}
    for row in visible:
        repo = repo_name_from_source_layer(row.get("source_layer", ""))
        folder = folder_key_from_relative_path(row["relative_path"])
        by_repo.setdefault(repo, {}).setdefault(folder, []).append(row)

    repo_keys = list(by_repo.keys())
    if sort_by_name:
        repo_keys.sort(key=str.lower)
    else:
        seen_order: list[str] = []
        for row in all_rows:
            repo = repo_name_from_source_layer(row.get("source_layer", ""))
            if repo in by_repo and repo not in seen_order:
                seen_order.append(repo)
        repo_keys = [r for r in seen_order if r in by_repo] + [
            r for r in repo_keys if r not in seen_order
        ]

    trees: list[PartsTreeNode] = []
    for repo in repo_keys:
        folder_map = by_repo.get(repo, {})
        folder_keys = order_folders(
            list(folder_map.keys()),
            sort_by_name=sort_by_name,
            pinned_folders=[f for f in pinned if f in folder_map],
            scan_order=folder_scan_order_list,
        )
        folder_nodes: list[PartsTreeNode] = []
        for folder_path in folder_keys:
            rows = folder_map.get(folder_path, [])
            rows.sort(
                key=lambda r: (
                    r["filename"].lower()
                    if sort_by_name
                    else scan_order.get(r["match_key"], 9999)
                )
            )
            part_nodes: list[PartsTreeNode] = []
            for row in rows:
                counts = _counts_for_part_profile(row, included_part_ids)
                part_nodes.append(
                    PartsTreeNode(
                        kind="part",
                        key=f"part:{row['id']}",
                        label=row.get("filename", ""),
                        repo=repo,
                        folder_path=folder_path,
                        counts=counts,
                        profile_row=row,
                    )
                )
            fcounts = _sum_counts(part_nodes)
            folder_nodes.append(
                PartsTreeNode(
                    kind="folder",
                    key=folder_node_key(repo, folder_path),
                    label=_format_folder_label(folder_path, fcounts),
                    repo=repo,
                    folder_path=folder_path,
                    children=part_nodes,
                    counts=fcounts,
                )
            )
        rcounts = _sum_counts(folder_nodes)
        trees.append(
            PartsTreeNode(
                kind="repo",
                key=f"repo:{repo}",
                label=_format_repo_label(repo, rcounts),
                repo=repo,
                folder_path="",
                children=folder_nodes,
                counts=rcounts,
            )
        )
    return trees


def build_wizard_parts_tree(
    parts: list[ScannedPart],
    *,
    included_match_keys: set[str],
    query: str = "",
    sort_by_name: bool = True,
    pinned_folders: list[str] | None = None,
    scan_order: dict[str, int] | None = None,
    folder_scan_order_list: list[str] | None = None,
    repo_label: str = "Parts",
) -> list[PartsTreeNode]:
    visible = filter_parts(parts, query)
    pinned = pinned_folders or []
    scan_order = scan_order or {p.match_key: i for i, p in enumerate(parts)}
    folder_scan_order_list = folder_scan_order_list or folder_scan_order(parts)

    by_folder: dict[str, list[ScannedPart]] = {}
    for part in visible:
        folder = folder_key_from_relative_path(part.relative_path)
        by_folder.setdefault(folder, []).append(part)

    folder_keys = order_folders(
        list(by_folder.keys()),
        sort_by_name=sort_by_name,
        pinned_folders=[f for f in pinned if f in by_folder],
        scan_order=folder_scan_order_list,
    )
    folder_nodes: list[PartsTreeNode] = []
    for folder_path in folder_keys:
        folder_parts = by_folder.get(folder_path, [])
        sorted_parts = sort_parts(
            folder_parts,
            sort_by_name=sort_by_name,
            scan_order=scan_order,
        )
        part_nodes: list[PartsTreeNode] = []
        for part in sorted_parts:
            counts = _counts_for_part_wizard(part, included_match_keys)
            part_nodes.append(
                PartsTreeNode(
                    kind="part",
                    key=f"part:{part.match_key}",
                    label=part.filename,
                    repo=repo_label,
                    folder_path=folder_path,
                    counts=counts,
                    scanned=part,
                )
            )
        fcounts = _sum_counts(part_nodes)
        folder_nodes.append(
            PartsTreeNode(
                kind="folder",
                key=folder_node_key(repo_label, folder_path),
                label=_format_folder_label(folder_path, fcounts),
                repo=repo_label,
                folder_path=folder_path,
                children=part_nodes,
                counts=fcounts,
            )
        )
    rcounts = _sum_counts(folder_nodes)
    return [
        PartsTreeNode(
            kind="repo",
            key=f"repo:{repo_label}",
            label=_format_repo_label(repo_label, rcounts),
            repo=repo_label,
            folder_path="",
            children=folder_nodes,
            counts=rcounts,
        )
    ]


def subtree_profile_part_ids(nodes: PartsTreeNode | list[PartsTreeNode]) -> list[int]:
    if isinstance(nodes, list):
        result: list[int] = []
        for node in nodes:
            result.extend(subtree_profile_part_ids(node))
        return result
    if nodes.kind == "part" and nodes.profile_row:
        return [int(nodes.profile_row["id"])]
    result = []
    for child in nodes.children:
        result.extend(subtree_profile_part_ids(child))
    return result


def subtree_wizard_match_keys(nodes: PartsTreeNode | list[PartsTreeNode]) -> list[str]:
    if isinstance(nodes, list):
        result: list[str] = []
        for node in nodes:
            result.extend(subtree_wizard_match_keys(node))
        return result
    if nodes.kind == "part" and nodes.scanned:
        return [nodes.scanned.match_key]
    result = []
    for child in nodes.children:
        result.extend(subtree_wizard_match_keys(child))
    return result


def node_matches_filter(node: PartsTreeNode, query: str) -> bool:
    q = query.strip()
    if not q:
        return True
    ql = q.lower()
    if node.kind == "part":
        if node.profile_row:
            scanned = display_dict_to_scanned(node.profile_row)
            folder = folder_key_from_relative_path(node.profile_row["relative_path"])
            if part_matches_query(scanned, folder, q):
                return True
            extra = (
                node.profile_row.get("source_layer", ""),
                node.profile_row.get("filament_display", ""),
            )
            return any(ql in text.lower() for text in extra if text)
        if node.scanned:
            folder = folder_key_from_relative_path(node.scanned.relative_path)
            return part_matches_query(node.scanned, folder, q)
    if ql in node.label.lower() or ql in node.repo.lower():
        return True
    return any(node_matches_filter(child, q) for child in node.children)


def prune_tree_for_filter(nodes: list[PartsTreeNode], query: str) -> list[PartsTreeNode]:
    q = query.strip()
    if not q:
        return nodes
    pruned: list[PartsTreeNode] = []
    for node in nodes:
        child_pruned = prune_tree_for_filter(node.children, q)
        if node.kind == "part":
            if node_matches_filter(node, q):
                pruned.append(
                    PartsTreeNode(
                        kind=node.kind,
                        key=node.key,
                        label=node.label,
                        repo=node.repo,
                        folder_path=node.folder_path,
                        children=[],
                        counts=node.counts,
                        profile_row=node.profile_row,
                        scanned=node.scanned,
                    )
                )
        elif child_pruned or node_matches_filter(node, q):
            pruned.append(
                PartsTreeNode(
                    kind=node.kind,
                    key=node.key,
                    label=node.label,
                    repo=node.repo,
                    folder_path=node.folder_path,
                    children=child_pruned,
                    counts=node.counts,
                    profile_row=node.profile_row,
                    scanned=node.scanned,
                )
            )
    return pruned
