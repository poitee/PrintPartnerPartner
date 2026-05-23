"""Portable kit bundle export/import."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from print_partner.core.export_kit_bundle import (
    KIT_JSON_NAME,
    export_kit_bundle,
    import_kit_bundle,
    profile_to_bundle_dict,
)
from print_partner.db.models import Base, BuildProfile, Part, ProfileLayer, Project
from print_partner.db.session import get_engine, get_profile_parts, init_db


@pytest.fixture
def engine():
    eng = get_engine()
    Base.metadata.create_all(eng)
    init_db()
    yield eng
    Base.metadata.drop_all(eng)


def _seed_profile(session: Session) -> tuple[int, int]:
    proj = Project(
        name="share-repo",
        url="https://github.com/example/parts.git",
        source_type="git",
        branch="main",
        local_path="/tmp/share-repo",
    )
    session.add(proj)
    session.flush()
    profile = BuildProfile(name="Share Me", order_number="ORD-1")
    session.add(profile)
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
            match_key="base:widget.stl",
            relative_path="widget.stl",
            filename="widget.stl",
            source_layer="base:share-repo",
            status="base",
            role="primary",
            quantity_auto=2,
            quantity_effective=2,
            included=True,
            notes="handle with care",
        )
    )
    session.commit()
    return profile.id, proj.id


def test_export_import_roundtrip(engine, tmp_path: Path) -> None:
    with Session(engine) as session:
        pid, _ = _seed_profile(session)
        dest = tmp_path / "kit.print-partner-kit.zip"
        export_kit_bundle(session, pid, dest)
        session.commit()

    with zipfile.ZipFile(dest) as zf:
        data = json.loads(zf.read(KIT_JSON_NAME))

    assert data["format"] == "print-partner-kit"
    assert data["profile"]["name"] == "Share Me"
    assert len(data["parts"]) == 1
    assert data["layers"][0]["project"]["name"] == "share-repo"

    with Session(engine) as session:
        result = import_kit_bundle(session, dest, new_name="Imported Share")
        session.commit()

    assert result.profile_name == "Imported Share"
    assert result.parts_imported == 1
    assert result.layers_imported == 1
    assert not result.unmatched_projects

    with Session(engine) as session:
        parts = get_profile_parts(session, result.profile_id)
        assert len(parts) == 1
        assert parts[0].notes == "handle with care"
        assert parts[0].quantity_effective == 2


def test_import_warns_on_missing_project(engine, tmp_path: Path) -> None:
    with Session(engine) as session:
        pid, proj_id = _seed_profile(session)
        dest = tmp_path / "orphan.print-partner-kit.zip"
        export_kit_bundle(session, pid, dest)
        proj = session.get(Project, proj_id)
        session.delete(proj)
        session.commit()

    with Session(engine) as session:
        result = import_kit_bundle(session, dest, new_name="Orphan Kit")
        session.commit()

    assert result.layers_imported == 0
    assert "share-repo" in result.unmatched_projects[0]
    assert result.parts_imported == 1


def test_profile_to_bundle_dict_requires_profile(engine) -> None:
    with Session(engine) as session:
        with pytest.raises(ValueError, match="not found"):
            profile_to_bundle_dict(session, 99999)
