"""Custom filament library and kit bundle sharing."""

from __future__ import annotations

import json

import pytest
from sqlalchemy.orm import Session

from print_partner.core.ambrosia_catalog import get_color_by_id
from print_partner.core.custom_filaments import (
    CUSTOM_PREFIX,
    add_custom_filament,
    export_library_file,
    import_library_file,
    load_custom_filaments,
    merge_filaments_from_dict,
    save_custom_filaments,
)
from print_partner.core.export_kit_bundle import export_kit_bundle, import_kit_bundle
from print_partner.db.models import Base, BuildProfile, Part
from print_partner.db.session import get_engine, get_profile_parts, init_db


@pytest.fixture
def custom_filaments_file(tmp_path, monkeypatch):
    path = tmp_path / "custom_filaments.json"
    monkeypatch.setattr(
        "print_partner.core.custom_filaments.custom_filaments_path",
        lambda: path,
    )
    return path


def test_add_and_lookup_custom_filament(custom_filaments_file) -> None:
    entry = add_custom_filament("Shop Red", "#c41230", product_line="Workshop")
    assert entry.color_id.startswith(CUSTOM_PREFIX)
    color = get_color_by_id(entry.color_id)
    assert color is not None
    assert color.display_name == "Shop Red"
    assert color.hex == "#c41230"
    assert color.combo_label == "Workshop · Shop Red"


def test_merge_import_library(custom_filaments_file) -> None:
    payload = {
        "format": "print-partner-custom-filaments",
        "version": 1,
        "filaments": [
            {
                "id": "shared01",
                "display_name": "Partner Blue",
                "hex": "#2244aa",
                "product_line": "Shared",
            }
        ],
    }
    count = merge_filaments_from_dict(payload)
    assert count == 1
    loaded = load_custom_filaments()
    assert any(f.display_name == "Partner Blue" for f in loaded)
    assert get_color_by_id(f"{CUSTOM_PREFIX}shared01") is not None


def test_export_import_roundtrip(custom_filaments_file, tmp_path) -> None:
    add_custom_filament("Export Me", "#ff00aa")
    dest = tmp_path / "lib.json"
    export_library_file(dest)
    save_custom_filaments([])
    assert load_custom_filaments() == []
    import_library_file(dest)
    assert len(load_custom_filaments()) == 1


def test_kit_bundle_includes_custom_filaments(custom_filaments_file, tmp_path) -> None:
    entry = add_custom_filament("Kit Color", "#112233")
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="kit-custom-fil")
        session.add(profile)
        session.flush()
        session.add(
            Part(
                profile_id=profile.id,
                match_key="x",
                relative_path="x.stl",
                filename="x.stl",
                source_layer="base",
                filament_color_id=entry.color_id,
            )
        )
        session.commit()
        profile_id = profile.id

    bundle_path = tmp_path / "test-kit.zip"
    with Session(engine) as session:
        export_kit_bundle(session, profile_id, bundle_path)

    raw = json.loads(
        __import__("zipfile").ZipFile(bundle_path).read("kit.json").decode("utf-8")
    )
    assert "custom_filaments" in raw
    ids = {f["id"] for f in raw["custom_filaments"]}
    assert entry.id in ids

    save_custom_filaments([])
    with Session(engine) as session:
        result = import_kit_bundle(session, bundle_path, new_name="imported-kit")
        session.commit()
        parts = get_profile_parts(session, result.profile_id)
        assert parts[0].filament_color_id == entry.color_id
    assert get_color_by_id(entry.color_id) is not None

    Base.metadata.drop_all(engine)
