from print_partner.core.ai_context import build_kit_context
from print_partner.db.models import Base, BuildProfile, Part, ProfileLayer, Project
from print_partner.db.session import db_session, get_engine, init_db, part_to_display_dict


def _setup_profile(session):
    proj = Project(name="Repo", url="https://example.com/r.git", branch="main", local_path="/tmp/r")
    session.add(proj)
    session.flush()
    profile = BuildProfile(name="Test kit")
    session.add(profile)
    session.flush()
    session.add(
        ProfileLayer(
            profile_id=profile.id,
            project_id=proj.id,
            layer_order=0,
            layer_type="base",
        )
    )
    session.add(
        Part(
            profile_id=profile.id,
            match_key="a.stl",
            relative_path="parts/a.stl",
            filename="a.stl",
            source_layer="base",
            role="primary",
            quantity_effective=1,
            included=True,
            status="base",
        )
    )
    session.flush()
    return profile.id


def test_build_kit_context_includes_summary_and_part():
    init_db()
    engine = get_engine()
    with db_session() as session:
        pid = _setup_profile(session)
        parts = session.query(Part).filter(Part.profile_id == pid).all()
        rows = [part_to_display_dict(p, session) for p in parts]
        text = build_kit_context(session, pid, rows, user_question="What should I print first?")
    assert "Test kit" in text
    assert "Included: 1" in text
    assert "parts/a.stl" in text
    assert "What should I print first?" in text
    Base.metadata.drop_all(engine)
