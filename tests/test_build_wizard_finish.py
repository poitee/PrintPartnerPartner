"""Wizard finish pipeline tests (no Qt)."""

from pathlib import Path

import pytest
from sqlalchemy import select

from print_partner.config import settings
from print_partner.core.wizard_finish import finish_wizard_build
from print_partner.core.wizard_state import WizardLayer, WizardState
from print_partner.db.models import BuildProfile, Part, Project
from print_partner.db.session import init_db


@pytest.fixture
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.ensure_dirs()
    init_db()
    return tmp_path


def _make_repo(tmp_path: Path, name: str, stl_name: str) -> Path:
    repo = settings.repos_dir / name
    repo.mkdir(parents=True, exist_ok=True)
    (repo / stl_name).write_bytes(b"solid fake")
    return repo


def test_finish_applies_inclusion_sets(isolated_db):
    base_repo = _make_repo(isolated_db, "base-kit", "widget.stl")
    addon_repo = _make_repo(isolated_db, "addon-kit", "extra.stl")
    (addon_repo / "skip.stl").write_bytes(b"solid skip")

    from sqlalchemy.orm import Session
    from print_partner.db.session import get_engine

    engine = get_engine()
    with Session(engine) as session:
        base_proj = Project(
            name="base-kit",
            url="file://test",
            source_type="local",
            local_path=str(base_repo),
        )
        addon_proj = Project(
            name="addon-kit",
            url="file://test2",
            source_type="local",
            local_path=str(addon_repo),
        )
        session.add_all([base_proj, addon_proj])
        session.flush()

        state = WizardState(
            profile_name="Wizard Test",
            base_project_id=base_proj.id,
            base_included={"widget.stl"},
        )
        state.addons.append(
            WizardLayer(
                layer_type="addon",
                project_id=addon_proj.id,
                layer_label="addon:addon-kit",
                included_match_keys={"extra.stl"},
            )
        )
        profile_id = finish_wizard_build(session, state)
        session.commit()

    with Session(engine) as session:
        parts = list(session.scalars(select(Part).where(Part.profile_id == profile_id)).all())
        by_key = {p.match_key: p for p in parts}
        assert by_key["widget.stl"].included is True
        assert by_key["extra.stl"].included is True
        assert by_key["skip.stl"].included is False
        assert by_key["skip.stl"].status == "excluded"
        profile = session.get(BuildProfile, profile_id)
        assert profile is not None
        assert profile.name == "Wizard Test"
