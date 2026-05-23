"""Validate and apply AI-suggested kit changes."""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from print_partner.core.ai_client import AiAction
from print_partner.db.models import Part
from print_partner.db.session import bulk_set_filament_color, get_profile_parts


@dataclass
class ApplyResult:
    applied: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)
    navigate_target: str | None = None


def apply_actions(
    session: Session,
    profile_id: int,
    actions: list[AiAction],
    *,
    valid_part_ids: set[int] | None = None,
) -> ApplyResult:
    result = ApplyResult()
    if valid_part_ids is None:
        valid_part_ids = {p.id for p in get_profile_parts(session, profile_id)}

    parts_by_id = {p.id: p for p in get_profile_parts(session, profile_id)}
    included_ids = {p.id for p in parts_by_id.values() if p.included}

    for action in actions:
        atype = (action.action_type or action.action or "").strip().lower()
        legacy = action.action.strip().lower() if hasattr(action, "action") else ""

        if atype in ("include", "exclude") or legacy in ("include", "exclude"):
            kind = atype if atype in ("include", "exclude") else legacy
            pid = action.part_id
            if pid not in valid_part_ids:
                result.skipped += 1
                result.errors.append(f"Unknown part_id {pid}")
                continue
            if kind == "include":
                included_ids.add(pid)
            else:
                included_ids.discard(pid)
            result.applied += 1
            continue

        if atype == "set_filament":
            pid = action.part_id
            fid = (action.filament_color_id or "").strip()
            if pid not in parts_by_id or not fid:
                result.skipped += 1
                continue
            part = parts_by_id[pid]
            part.filament_color_id = fid
            part.filament_custom_hex = None
            result.applied += 1
            continue

        if atype == "set_role":
            pid = action.part_id
            role = (action.role or "").strip()
            if pid not in parts_by_id or role not in ("primary", "accent", "clear", "opaque"):
                result.skipped += 1
                continue
            parts_by_id[pid].role = role
            result.applied += 1
            continue

        if atype == "set_quantity":
            pid = action.part_id
            qty = action.quantity
            if pid not in parts_by_id or qty is None or qty < 1:
                result.skipped += 1
                continue
            part = parts_by_id[pid]
            part.quantity_override = int(qty)
            part.quantity_effective = int(qty)
            result.applied += 1
            continue

        if atype == "set_notes":
            pid = action.part_id
            if pid not in parts_by_id:
                result.skipped += 1
                continue
            parts_by_id[pid].notes = action.notes or ""
            result.applied += 1
            continue

        if atype == "assign_filament_to_role":
            role = (action.role or "").strip()
            fid = (action.filament_color_id or "").strip()
            if role not in ("primary", "accent", "clear", "opaque") or not fid:
                result.skipped += 1
                continue
            n = bulk_set_filament_color(session, profile_id, role, fid)
            result.applied += max(n, 1)
            continue

        if atype == "navigate":
            target = (action.target or "").strip().lower()
            if target in ("libraries", "compose", "review", "checkoff", "kit"):
                result.navigate_target = "libraries" if target == "libraries" else target
                if target == "kit":
                    result.navigate_target = "compose"
                result.applied += 1
            else:
                result.skipped += 1
            continue

        result.skipped += 1

    _persist_inclusion(session, parts_by_id, included_ids)
    return result


def _persist_inclusion(session: Session, parts_by_id: dict[int, Part], included_ids: set[int]) -> None:
    for part in parts_by_id.values():
        included = part.id in included_ids
        part.included = included
        if included:
            if part.status == "excluded":
                part.status = "base"
        else:
            part.status = "excluded"
