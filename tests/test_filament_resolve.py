"""Tests for filament hex resolution (unset red, custom override, display dict)."""

from __future__ import annotations

from print_partner.core.ambrosia_catalog import resolve_filament_hex
from print_partner.core.filament_color_resolve import (
    UNASSIGNED_FILAMENT_HEX,
    resolve_part_filament_hex,
)
from print_partner.db.models import Base, BuildProfile, Part
from print_partner.db.session import get_engine, init_db, part_to_display_dict
from sqlalchemy.orm import Session


def test_resolve_filament_hex_unset_returns_red():
    assert resolve_filament_hex(None, "primary") == UNASSIGNED_FILAMENT_HEX


def test_resolve_filament_hex_custom_override():
    assert (
        resolve_filament_hex("abs-matte::voron-red", "primary", filament_custom_hex="#00ff00")
        == "#00ff00"
    )


def test_resolve_part_filament_hex_custom_beats_catalog():
    part = Part(
        profile_id=1,
        match_key="x",
        relative_path="x.stl",
        filename="x.stl",
        source_layer="base",
        filament_color_id="abs-matte::voron-red",
        filament_custom_hex="#aabbcc",
    )
    assert resolve_part_filament_hex(part) == "#aabbcc"


def test_resolve_part_filament_hex_unset_is_red():
    part = Part(
        profile_id=1,
        match_key="x",
        relative_path="x.stl",
        filename="x.stl",
        source_layer="base",
    )
    assert resolve_part_filament_hex(part) == UNASSIGNED_FILAMENT_HEX


def test_part_to_display_dict_uses_effective_hex():
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="hex-display-test")
        session.add(profile)
        session.flush()
        part = Part(
            profile_id=profile.id,
            match_key="a",
            relative_path="a.stl",
            filename="a.stl",
            source_layer="base",
        )
        session.add(part)
        session.commit()
        session.refresh(part)
        display = part_to_display_dict(part)
        assert display["filament_hex"] == UNASSIGNED_FILAMENT_HEX
    Base.metadata.drop_all(engine)
