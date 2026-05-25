"""Build context strings for the AI assistant from the active profile."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from print_partner.core.ai_capabilities import ACTION_SCHEMA, workflow_manifest
from print_partner.core.repo_readme import find_readme, read_readme_text
from print_partner.db.models import BuildProfile, Project
from print_partner.db.session import get_profile_layers, list_projects

_MAX_README_CHARS = 6000
_MAX_PART_LINES = 120


def build_kit_context(
    session: Session,
    profile_id: int,
    part_dicts: list[dict],
    *,
    selected_part_id: int | None = None,
    user_question: str | None = None,
    screen: str = "compose",
    top_tab: str = "kit",
) -> str:
    profile = session.get(BuildProfile, profile_id)
    layers = get_profile_layers(session, profile_id)
    included = [r for r in part_dicts if r.get("included")]
    excluded = [r for r in part_dicts if not r.get("included")]
    conflicts = [r for r in included if r.get("status") == "conflict"]
    unset_filament = [r for r in included if not r.get("filament_color_id")]

    lines = [
        "# Print Partner kit context",
        f"Current screen: {top_tab} / {screen}",
        f"Profile: {profile.name if profile else profile_id}",
    ]
    lines.append("")
    lines.append(workflow_manifest())
    lines.append("")
    lines.append("## Repositories on this machine")
    for proj in list_projects(session):
        sync = "synced" if proj.local_path else "not synced"
        lines.append(f"- {proj.name} ({sync})")
    lines.append("")
    lines.append("## Filament catalog ids (use in set_filament / assign_filament_to_role)")
    try:
        from print_partner.core.custom_filaments import merged_filament_by_id

        merged = merged_filament_by_id()
        for cid, color in sorted(merged.items(), key=lambda x: x[0])[:60]:
            lines.append(f"- {cid}: {color.combo_label}")
    except Exception:
        lines.append("- (catalog unavailable)")
    if profile and profile.order_number:
        lines.append(f"Order #: {profile.order_number}")
    lines.append("")
    lines.append("## Layers")
    for layer in layers:
        label = layer.layer_type
        if layer.project_id:
            proj = session.get(Project, layer.project_id)
            if proj:
                label = f"{layer.layer_type}: {proj.name}"
        lines.append(f"- {label} (order {layer.layer_order})")

    lines.append("")
    lines.append("## Summary")
    lines.append(f"- Total parts: {len(part_dicts)}")
    lines.append(f"- Included: {len(included)}")
    lines.append(f"- Excluded: {len(excluded)}")
    lines.append(f"- Conflicts (included): {len(conflicts)}")
    lines.append(f"- Included without filament color: {len(unset_filament)}")

    lines.append("")
    lines.append("## Parts (id | included | status | role | filename)")
    shown = 0
    for row in part_dicts:
        if shown >= _MAX_PART_LINES:
            lines.append(f"... and {len(part_dicts) - shown} more parts")
            break
        inc = "yes" if row.get("included") else "no"
        lines.append(
            f"- {row['id']} | {inc} | {row.get('status', '')} | {row.get('role', '')} | "
            f"{row.get('relative_path', row.get('filename', ''))}"
        )
        shown += 1

    if selected_part_id is not None:
        sel = next((r for r in part_dicts if r["id"] == selected_part_id), None)
        if sel:
            lines.append("")
            lines.append("## Selected part")
            lines.append(f"id={sel['id']} path={sel.get('relative_path')} role={sel.get('role')}")
            if sel.get("notes"):
                lines.append(f"notes: {sel['notes']}")

    readme_block = _readme_excerpts(session, layers)
    if readme_block:
        lines.append("")
        lines.append("## README excerpts")
        lines.append(readme_block)

    if user_question:
        lines.append("")
        lines.append("## User question")
        lines.append(user_question.strip())

    lines.append("")
    lines.append(ACTION_SCHEMA)

    return "\n".join(lines)


def context_snapshot(part_dicts: list[dict]) -> str:
    included = sum(1 for r in part_dicts if r.get("included"))
    conflicts = sum(1 for r in part_dicts if r.get("included") and r.get("status") == "conflict")
    return f"{len(part_dicts)} parts · {included} included · {conflicts} conflicts"


def _readme_excerpts(session: Session, layers) -> str:
    chunks: list[str] = []
    total = 0
    seen_roots: set[str] = set()
    for layer in layers:
        if not layer.project_id:
            continue
        proj = session.get(Project, layer.project_id)
        if not proj or not proj.local_path:
            continue
        root = Path(proj.local_path)
        key = str(root.resolve())
        if key in seen_roots or not root.is_dir():
            continue
        seen_roots.add(key)
        readme = find_readme(root)
        if not readme:
            continue
        text = read_readme_text(readme)
        if not text:
            continue
        header = f"### {proj.name} ({readme.name})\n"
        body = text.strip()
        if len(body) > 2000:
            body = body[:2000] + "\n…(truncated)"
        piece = header + body
        if total + len(piece) > _MAX_README_CHARS:
            break
        chunks.append(piece)
        total += len(piece)
    return "\n\n".join(chunks)
