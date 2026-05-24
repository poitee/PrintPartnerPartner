"""Tests for 3MF kit export."""

from __future__ import annotations

from pathlib import Path

import lib3mf
from sqlalchemy.orm import Session

from print_partner.core.export_3mf import (
    Export3mfOptions,
    export_profile_3mf,
    object_display_name,
    sanitize_3mf_object_name,
)
from print_partner.core.merge import MergePart
from print_partner.core.part_paths import resolve_part_stl_path
from print_partner.core.printer_fleet import LoadedFilament, PrinterMachine
from print_partner.db.models import BuildProfile, Part, ProfileLayer, Project
from print_partner.db.session import get_engine, init_db


def test_sanitize_3mf_object_name():
    assert sanitize_3mf_object_name("parts/bracket.stl") == "bracket.stl"
    assert sanitize_3mf_object_name("weird<name>.stl") == "weird_name_.stl"


def test_object_display_name_quantity():
    used: set[str] = set()
    assert object_display_name("bracket.stl", 1, used) == "bracket.stl"
    assert object_display_name("bracket.stl", 2, used) == "bracket.stl (2)"
    assert object_display_name("bracket.stl", 3, used) == "bracket.stl (3)"


def _minimal_stl_bytes() -> bytes:
    return b"""solid t
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 10 0 0
      vertex 0 10 0
    endloop
  endfacet
endsolid t
"""


def test_export_profile_3mf_names_and_count(tmp_path: Path):
    repo = tmp_path / "repo"
    repo.mkdir()
    stl = repo / "parts" / "bracket.stl"
    stl.parent.mkdir(parents=True)
    stl.write_bytes(_minimal_stl_bytes())

    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="3MF Test")
        session.add(profile)
        session.flush()
        proj = Project(name="3mf-proj", url="https://example.com", local_path=str(repo))
        session.add(proj)
        session.flush()
        session.add(
            ProfileLayer(
                profile_id=profile.id,
                layer_order=0,
                layer_type="base",
                project_id=proj.id,
            )
        )
        session.add(
            Part(
                profile_id=profile.id,
                match_key="parts/bracket.stl",
                relative_path="parts/bracket.stl",
                filename="bracket.stl",
                source_layer="base:3mf-proj",
                role="primary",
                quantity_effective=2,
                included=True,
            )
        )
        session.commit()
        profile_id = profile.id

    exports = tmp_path / "exports"
    printer = PrinterMachine(
        id="test-printer",
        name="Test Bed",
        bed_width_mm=200,
        bed_depth_mm=200,
        loaded_filaments=[LoadedFilament(slot=1, filament_color_id="asa-black")],
    )
    printer.ensure_slots()
    with Session(engine) as session:
        part = session.query(Part).filter(Part.profile_id == profile_id).one()
        stl_path = resolve_part_stl_path(session, part)
        assert stl_path is not None
        mp = MergePart(
            match_key=part.match_key,
            relative_path=part.relative_path,
            filename=part.filename,
            source_layer=part.source_layer,
            status=part.status,
            role=part.role,
            quantity_auto=part.quantity_effective,
            quantity_override=part.quantity_override,
            part_slug=part.filename,
            included=True,
            absolute_path=stl_path,
            filament_color_id="asa-black",
            filament_display="ASA Black",
        )
        result = export_profile_3mf(
            "3MF Test",
            [mp],
            exports,
            options=Export3mfOptions(enabled_printers=[printer], layout_mode="per_plate"),
        )

    assert result.object_count == 2
    assert result.paths
    out_path = result.paths[0]
    assert out_path.is_file()

    wrapper = lib3mf.get_wrapper()
    model = wrapper.CreateModel()
    reader = model.QueryReader("3mf")
    reader.ReadFromFile(str(out_path))

    names: list[str] = []
    build_items = model.GetBuildItems()
    while build_items.MoveNext():
        item = build_items.GetCurrent()
        mesh = model.GetMeshObjectByID(item.GetObjectResourceID())
        names.append(mesh.GetName())

    assert names == ["bracket.stl", "bracket.stl (2)"]


def test_export_3mf_missing_stl_warns(tmp_path: Path):
    printer = PrinterMachine(id="p", name="P", bed_width_mm=200, bed_depth_mm=200)
    printer.ensure_slots()
    mp = MergePart(
        match_key="x",
        relative_path="missing.stl",
        filename="missing.stl",
        source_layer="base",
        status="base",
        role="primary",
        quantity_auto=1,
        part_slug="missing.stl",
        included=True,
        absolute_path=None,
    )
    result = export_profile_3mf(
        "Empty",
        [mp],
        tmp_path / "exports",
        options=Export3mfOptions(enabled_printers=[printer]),
    )
    assert result.object_count == 0
    assert result.warnings
