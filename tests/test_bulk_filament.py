"""Bulk filament assignment persists catalog id and custom hex."""

from __future__ import annotations

from sqlalchemy.orm import Session

from print_partner.core.filament_color_resolve import resolve_part_filament_hex
from print_partner.db.models import Base, BuildProfile, Part
from print_partner.db.session import bulk_set_filament_color, get_engine, init_db


def test_bulk_set_filament_color_sets_custom_hex():
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="bulk-test")
        session.add(profile)
        session.flush()
        part = Part(
            profile_id=profile.id,
            match_key="a.stl",
            relative_path="a.stl",
            filename="a.stl",
            source_layer="base",
            role="primary",
        )
        session.add(part)
        session.commit()
        updated = bulk_set_filament_color(
            session,
            profile.id,
            "primary",
            "abs-matte::voron-red",
            included_only=False,
            custom_hex="#00ff00",
        )
        session.commit()
        session.refresh(part)
        assert updated == 1
        assert part.filament_color_id == "abs-matte::voron-red"
        assert part.filament_custom_hex == "#00ff00"
        assert resolve_part_filament_hex(part) == "#00ff00"
    Base.metadata.drop_all(engine)


def test_bulk_clear_custom_hex_uses_catalog():
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="bulk-catalog")
        session.add(profile)
        session.flush()
        part = Part(
            profile_id=profile.id,
            match_key="b.stl",
            relative_path="b.stl",
            filename="b.stl",
            source_layer="base",
            role="accent",
            filament_color_id="abs-matte::voron-red",
            filament_custom_hex="#aabbcc",
        )
        session.add(part)
        session.commit()
        bulk_set_filament_color(
            session,
            profile.id,
            "accent",
            "abs-matte::voron-red",
            included_only=False,
            custom_hex=None,
        )
        session.commit()
        session.refresh(part)
        assert part.filament_custom_hex is None
        assert resolve_part_filament_hex(part) == "#c41230"
    Base.metadata.drop_all(engine)
