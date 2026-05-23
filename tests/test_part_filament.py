"""Tests for part filament color persistence."""

from __future__ import annotations

from sqlalchemy.orm import Session

from print_partner.db.models import Base, BuildProfile, Part
from print_partner.db.session import (
    bulk_set_filament_color,
    get_engine,
    init_db,
    part_to_display_dict,
)


def test_part_filament_color_migration_and_bulk_assign():
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="test-filament-profile")
        session.add(profile)
        session.flush()
        session.add_all(
            [
                Part(
                    profile_id=profile.id,
                    match_key="a",
                    relative_path="a.stl",
                    filename="a.stl",
                    source_layer="base",
                    role="accent",
                ),
                Part(
                    profile_id=profile.id,
                    match_key="b",
                    relative_path="b.stl",
                    filename="b.stl",
                    source_layer="base",
                    role="primary",
                ),
            ]
        )
        session.commit()
        profile_id = profile.id

    with Session(engine) as session:
        n = bulk_set_filament_color(
            session, profile_id, "accent", "pla::voron-red", included_only=False
        )
        session.commit()
        assert n == 1
        parts = session.query(Part).filter(Part.profile_id == profile_id).all()
        accent = next(p for p in parts if p.role == "accent")
        primary = next(p for p in parts if p.role == "primary")
        assert accent.filament_color_id == "pla::voron-red"
        assert primary.filament_color_id is None
        display = part_to_display_dict(accent)
        assert display["filament_color_id"] == "pla::voron-red"
        assert display["filament_hex"] is not None

    Base.metadata.drop_all(engine)
