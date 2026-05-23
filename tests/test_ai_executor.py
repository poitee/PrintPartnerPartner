from print_partner.core.ai_client import AiAction
from print_partner.core.ai_executor import apply_actions
from print_partner.db.models import Base, BuildProfile, Part, ProfileLayer, Project
from print_partner.db.session import db_session, get_engine, get_profile_parts, init_db


def _seed(session):
    proj = Project(name="R", url="https://x.git", branch="main", local_path="/tmp/r")
    session.add(proj)
    session.flush()
    profile = BuildProfile(name="Kit")
    session.add(profile)
    session.flush()
    session.add(ProfileLayer(profile_id=profile.id, project_id=proj.id, layer_order=0, layer_type="base"))
    p1 = Part(
        profile_id=profile.id,
        match_key="a.stl",
        relative_path="a.stl",
        filename="a.stl",
        source_layer="base",
        role="primary",
        quantity_effective=1,
        included=False,
        status="excluded",
    )
    p2 = Part(
        profile_id=profile.id,
        match_key="b.stl",
        relative_path="b.stl",
        filename="b.stl",
        source_layer="base",
        role="accent",
        quantity_effective=2,
        included=True,
        status="base",
    )
    session.add_all([p1, p2])
    session.flush()
    return profile.id, p1.id, p2.id


def test_apply_include_and_set_quantity():
    init_db()
    engine = get_engine()
    with db_session() as session:
        pid, p1_id, p2_id = _seed(session)
        result = apply_actions(
            session,
            pid,
            [
                AiAction(action_type="include", part_id=p1_id, action="include"),
                AiAction(action_type="set_quantity", part_id=p2_id, quantity=5),
            ],
        )
        assert result.applied == 2
        parts = {p.id: p for p in get_profile_parts(session, pid)}
        assert parts[p1_id].included is True
        assert parts[p2_id].quantity_effective == 5
    Base.metadata.drop_all(engine)


def test_apply_navigate_target():
    init_db()
    engine = get_engine()
    with db_session() as session:
        pid, p1_id, _ = _seed(session)
        result = apply_actions(
            session,
            pid,
            [AiAction(action_type="navigate", target="review")],
        )
        assert result.navigate_target == "review"
    Base.metadata.drop_all(engine)
