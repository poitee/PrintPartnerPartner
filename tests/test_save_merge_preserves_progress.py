"""Recompute must not wipe print progress for parts that still exist."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from print_partner.core.merge import MergePart, MergeResult
from print_partner.core.print_progress import get_print_units, set_unit_completed
from print_partner.db.models import Base, BuildProfile, Part
from print_partner.db.session import get_engine, init_db, save_merge_result


def test_save_merge_result_preserves_print_progress():
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="preserve-progress")
        session.add(profile)
        session.flush()
        part = Part(
            profile_id=profile.id,
            match_key="parts/bracket.stl",
            relative_path="parts/bracket.stl",
            filename="bracket.stl",
            source_layer="base:Test",
            status="base",
            role="primary",
            quantity_auto=2,
            quantity_effective=2,
            included=True,
        )
        session.add(part)
        session.flush()
        part_id = part.id
        set_unit_completed(session, part_id, 0, True)
        session.commit()

        result = MergeResult(
            parts=[
                MergePart(
                    match_key="parts/bracket.stl",
                    relative_path="parts/bracket.stl",
                    filename="bracket.stl",
                    source_layer="base:Test",
                    status="base",
                    role="accent",
                    quantity_auto=2,
                    part_slug="bracket",
                    included=True,
                )
            ]
        )
        save_merge_result(session, profile.id, result)
        session.commit()

        updated = session.scalars(
            select(Part).where(Part.profile_id == profile.id)
        ).one()
        assert updated.id == part_id
        assert updated.role == "primary"
        units = get_print_units(session, part_id, 2)
        assert units[0] is True
        assert units[1] is False
    Base.metadata.drop_all(engine)
