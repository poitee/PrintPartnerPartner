"""Tests for STL zip export."""

from __future__ import annotations

import zipfile
from pathlib import Path

from sqlalchemy.orm import Session

from print_partner.core.export_stl_zip import export_profile_stl_zips
from print_partner.core.merge import MergePart
from print_partner.core.part_paths import resolve_part_stl_path
from print_partner.db.models import Base, BuildProfile, Part, ProfileLayer, Project
from print_partner.db.session import get_engine, init_db


def test_export_stl_zip_qty_duplicates(tmp_path: Path, monkeypatch):
    repo = tmp_path / "repo"
    repo.mkdir()
    stl = repo / "parts" / "bracket.stl"
    stl.parent.mkdir(parents=True)
    stl.write_bytes(b"solid fake")

    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="Zip Test")
        session.add(profile)
        session.flush()
        proj = Project(name="zip-proj", url="https://example.com", local_path=str(repo))
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
                source_layer="base:zip-proj",
                role="primary",
                quantity_effective=3,
                included=True,
            )
        )
        session.commit()
        profile_id = profile.id

    exports = tmp_path / "exports"
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
        )
        root, zip_counts, warnings = export_profile_stl_zips(
            "Zip Test", [mp], exports
        )

    assert warnings == []
    assert zip_counts.get("primary") == 1
    zip_path = root / "primary" / "parts.zip"
    assert zip_path.is_file()
    with zipfile.ZipFile(zip_path) as zf:
        names = sorted(zf.namelist())
        assert names == ["bracket_01.stl", "bracket_02.stl", "bracket_03.stl"]

    Base.metadata.drop_all(engine)


def test_resolve_part_stl_path_uses_source_layer(tmp_path: Path, monkeypatch):
    base_repo = tmp_path / "base"
    addon_repo = tmp_path / "addon"
    base_repo.mkdir()
    addon_repo.mkdir()
    (base_repo / "shared.stl").write_bytes(b"base")
    (addon_repo / "shared.stl").write_bytes(b"addon")

    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="layer-pick")
        session.add(profile)
        session.flush()
        base_p = Project(name="base-kit", url="https://a.com", local_path=str(base_repo))
        addon_p = Project(name="addon-kit", url="https://b.com", local_path=str(addon_repo))
        session.add_all([base_p, addon_p])
        session.flush()
        session.add(
            ProfileLayer(
                profile_id=profile.id,
                layer_order=0,
                layer_type="base",
                project_id=base_p.id,
            )
        )
        session.add(
            ProfileLayer(
                profile_id=profile.id,
                layer_order=1,
                layer_type="addon",
                project_id=addon_p.id,
            )
        )
        part = Part(
            profile_id=profile.id,
            match_key="shared.stl",
            relative_path="shared.stl",
            filename="shared.stl",
            source_layer="addon:addon-kit",
            included=True,
        )
        session.add(part)
        session.commit()
        pid = part.id

    with Session(engine) as session:
        part = session.get(Part, pid)
        path = resolve_part_stl_path(session, part)
        assert path is not None
        assert path.read_bytes() == b"addon"

    Base.metadata.drop_all(engine)
