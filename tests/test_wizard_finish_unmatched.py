"""Finish marks parts excluded when not in layer inclusion set."""


from sqlalchemy import select
from sqlalchemy.orm import Session

from print_partner.config import settings
from print_partner.core.wizard_finish import finish_wizard_build
from print_partner.core.wizard_state import WizardState
from print_partner.db.models import Part, Project
from print_partner.db.session import get_engine, init_db


def test_finish_excludes_parts_not_in_included_set(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.ensure_dirs()
    init_db()

    base_repo = settings.repos_dir / "base-kit"
    base_repo.mkdir(parents=True)
    (base_repo / "keep.stl").write_bytes(b"solid")
    (base_repo / "drop.stl").write_bytes(b"solid")

    engine = get_engine()
    with Session(engine) as session:
        proj = Project(
            name="base-kit",
            url="file://test",
            source_type="local",
            local_path=str(base_repo),
        )
        session.add(proj)
        session.flush()

        state = WizardState(
            profile_name="Inclusion Test",
            base_project_id=proj.id,
            base_included={"keep.stl"},
        )
        profile_id = finish_wizard_build(session, state)
        session.commit()

    with Session(engine) as session:
        parts = list(session.scalars(select(Part).where(Part.profile_id == profile_id)).all())
        by_key = {p.match_key: p for p in parts}
        assert by_key["keep.stl"].included is True
        assert by_key["drop.stl"].included is False
        assert by_key["drop.stl"].status == "excluded"
