"""Print progress CRUD for per-part unit completion."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from print_partner.db.models import Part, PrintProgress


def ensure_progress_rows(session: Session, part: Part) -> None:
    """Ensure print_progress rows exist for unit_index 0..qty-1."""
    qty = max(1, part.quantity_effective)
    existing = {
        row.unit_index: row
        for row in session.scalars(
            select(PrintProgress).where(PrintProgress.part_id == part.id)
        ).all()
    }
    for unit_index in range(qty):
        if unit_index not in existing:
            session.add(
                PrintProgress(part_id=part.id, unit_index=unit_index, completed=False)
            )
    for unit_index, row in existing.items():
        if unit_index >= qty:
            session.delete(row)


def ensure_profile_progress(session: Session, profile_id: int) -> None:
    """Sync progress rows for all parts in a profile."""
    for part in session.scalars(select(Part).where(Part.profile_id == profile_id)).all():
        ensure_progress_rows(session, part)


def get_printed_counts(session: Session, profile_id: int) -> dict[int, tuple[int, int]]:
    """Return part_id -> (completed_count, total_qty)."""
    counts: dict[int, tuple[int, int]] = {}
    for part in session.scalars(select(Part).where(Part.profile_id == profile_id)).all():
        rows = list(
            session.scalars(select(PrintProgress).where(PrintProgress.part_id == part.id)).all()
        )
        total = max(1, part.quantity_effective)
        completed = sum(1 for r in rows if r.completed)
        counts[part.id] = (completed, total)
    return counts


def print_units_by_part_id(session: Session, profile_id: int) -> dict[int, list[bool]]:
    """Load all print-unit flags for a profile in two queries (avoids N+1)."""
    parts = list(session.scalars(select(Part).where(Part.profile_id == profile_id)).all())
    if not parts:
        return {}
    qty_by_part = {p.id: max(1, p.quantity_effective) for p in parts}
    part_ids = list(qty_by_part.keys())
    rows = session.scalars(
        select(PrintProgress).where(PrintProgress.part_id.in_(part_ids))
    ).all()
    flags: dict[int, dict[int, bool]] = {}
    for row in rows:
        flags.setdefault(row.part_id, {})[row.unit_index] = row.completed
    return {
        pid: [flags.get(pid, {}).get(i, False) for i in range(qty_by_part[pid])]
        for pid in part_ids
    }


def get_print_units(session: Session, part_id: int, qty: int) -> list[bool]:
    rows = {
        r.unit_index: r.completed
        for r in session.scalars(
            select(PrintProgress).where(PrintProgress.part_id == part_id)
        ).all()
    }
    return [rows.get(i, False) for i in range(max(1, qty))]


def set_unit_completed(
    session: Session, part_id: int, unit_index: int, completed: bool
) -> None:
    row = session.scalars(
        select(PrintProgress).where(
            PrintProgress.part_id == part_id,
            PrintProgress.unit_index == unit_index,
        )
    ).first()
    if row is None:
        session.add(
            PrintProgress(part_id=part_id, unit_index=unit_index, completed=completed)
        )
    else:
        row.completed = completed


def mark_part_printed(session: Session, part_id: int, *, all: bool = True) -> None:
    part = session.get(Part, part_id)
    if not part:
        return
    ensure_progress_rows(session, part)
    qty = max(1, part.quantity_effective)
    for unit_index in range(qty):
        set_unit_completed(session, part_id, unit_index, completed=all)


def copy_progress_on_duplicate(
    session: Session,
    old_parts: list[Part],
    new_parts: list[Part],
) -> None:
    """Copy print progress from old parts to new by match_key."""
    old_by_key = {p.match_key: p for p in old_parts}
    for new_part in new_parts:
        old = old_by_key.get(new_part.match_key)
        if not old:
            continue
        ensure_progress_rows(session, new_part)
        old_units = get_print_units(session, old.id, old.quantity_effective)
        for unit_index, completed in enumerate(old_units):
            if unit_index < new_part.quantity_effective:
                set_unit_completed(session, new_part.id, unit_index, completed)
