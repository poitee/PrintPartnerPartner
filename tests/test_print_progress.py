"""Tests for print progress tracking."""

from __future__ import annotations

from print_partner.core.print_progress import (
    ensure_progress_rows,
    get_print_units,
    get_printed_counts,
    mark_part_printed,
    set_unit_completed,
)
from print_partner.db.models import Base, BuildProfile, Part
from print_partner.db.session import get_engine, init_db
from sqlalchemy.orm import Session


def test_print_progress_units():
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="progress-test")
        session.add(profile)
        session.flush()
        part = Part(
            profile_id=profile.id,
            match_key="a.stl",
            relative_path="a.stl",
            filename="a.stl",
            source_layer="base",
            quantity_effective=3,
        )
        session.add(part)
        session.commit()
        part_id = part.id
        profile_id = profile.id

    with Session(engine) as session:
        part = session.get(Part, part_id)
        ensure_progress_rows(session, part)
        session.commit()

    with Session(engine) as session:
        part = session.get(Part, part_id)
        units = get_print_units(session, part_id, 3)
        assert units == [False, False, False]
        set_unit_completed(session, part_id, 0, True)
        set_unit_completed(session, part_id, 1, True)
        session.commit()

    with Session(engine) as session:
        counts = get_printed_counts(session, profile_id)
        assert counts[part_id] == (2, 3)
        mark_part_printed(session, part_id, all=True)
        session.commit()
        assert get_print_units(session, part_id, 3) == [True, True, True]

    Base.metadata.drop_all(engine)
