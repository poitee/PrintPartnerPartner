"""Checkoff progress, missing-only export pool, and filters."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from print_partner.core.checkoff_missing import (
    count_unprinted_units,
    filter_checkoff_display_rows,
    prepare_print_plan_for_missing,
    unprinted_copies,
)
from print_partner.core.filament_assigner import PartCopy
from print_partner.core.merge import MergePart
from print_partner.core.print_plan import load_kit_print_plan
from print_partner.core.print_progress import (
    print_units_by_part_id,
    set_printed_unit_count,
)
from print_partner.db.models import BuildProfile, Part
from print_partner.db.session import get_engine, init_db


def _merge_part(
    key: str,
    *,
    included: bool = True,
    qty: int = 1,
    path: Path | None = None,
) -> MergePart:
    mp = MergePart(
        match_key=key,
        relative_path=key,
        filename=Path(key).name,
        source_layer="base:test",
        status="base",
        role="primary",
        quantity_auto=qty,
        quantity_override=qty,
        part_slug=Path(key).name,
        included=included,
    )
    if path:
        mp.absolute_path = path
    return mp


def test_unprinted_copies_respects_per_unit_flags(tmp_path: Path):
    stl = tmp_path / "a.stl"
    stl.write_bytes(b"solid x\nendsolid x\n")
    parts = [_merge_part("a.stl", qty=3, path=stl)]
    completed = {"a.stl": [True, False, False]}
    copies = unprinted_copies(parts, completed)
    assert len(copies) == 2
    assert all(isinstance(c, PartCopy) for c in copies)
    assert {c.unit for c in copies} == {2, 3}


def test_unprinted_skips_excluded_and_missing_stl(tmp_path: Path):
    stl = tmp_path / "ok.stl"
    stl.write_bytes(b"solid x\nendsolid x\n")
    parts = [
        _merge_part("ok.stl", path=stl),
        _merge_part("no.stl"),
        _merge_part("off.stl", included=False, path=stl),
    ]
    copies = unprinted_copies(parts, {})
    assert len(copies) == 1
    assert copies[0].part.match_key == "ok.stl"


def test_count_unprinted_units_and_filters():
    rows = [
        {"included": True, "quantity_effective": 2, "printed_count": 1},
        {"included": True, "quantity_effective": 1, "printed_count": 1},
        {"included": False, "quantity_effective": 5, "printed_count": 0},
    ]
    assert count_unprinted_units(rows) == 1
    missing = filter_checkoff_display_rows(rows, "missing")
    assert len(missing) == 1
    done = filter_checkoff_display_rows(rows, "done")
    assert len(done) == 1


def test_prepare_print_plan_for_missing_persists_pool(tmp_path: Path):
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="Checkoff")
        session.add(profile)
        session.flush()
        part = Part(
            profile_id=profile.id,
            match_key="p.stl",
            relative_path="p.stl",
            filename="p.stl",
            source_layer="base:x",
            role="primary",
            quantity_effective=2,
            included=True,
        )
        session.add(part)
        session.commit()
        pid = profile.id
        part_id = part.id

    stl = tmp_path / "p.stl"
    stl.write_bytes(b"solid x\nendsolid x\n")
    merge = [_merge_part("p.stl", qty=2, path=stl)]
    completed = {"p.stl": [True, False]}

    n, layout = prepare_print_plan_for_missing(pid, merge, completed)
    assert n == 1
    assert layout is not None
    plan = load_kit_print_plan(pid)
    assert plan.plate_layout is not None
    assert len(plan.plate_layout.pool) == 1

    with Session(engine) as session:
        set_printed_unit_count(session, part_id, 2)
        session.commit()
        units = print_units_by_part_id(session, pid)
    assert units[part_id] == [True, True]
    assert unprinted_copies(merge, {"p.stl": units[part_id]}) == []
