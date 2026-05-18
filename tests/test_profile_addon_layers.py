"""Addon layer stacking in profile_ops."""

from __future__ import annotations

from print_partner.core.profile_ops import add_addon_project
from print_partner.db.models import Base, BuildProfile, ProfileLayer, Project
from print_partner.db.session import get_engine, get_profile_layers, init_db
from sqlalchemy.orm import Session


def test_add_multiple_addon_layers():
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="addon-stack")
        session.add(profile)
        session.flush()
        p1 = Project(name="proj-a", url="https://a.example", local_path="/tmp/a")
        p2 = Project(name="proj-b", url="https://b.example", local_path="/tmp/b")
        session.add_all([p1, p2])
        session.flush()
        session.add(
            ProfileLayer(
                profile_id=profile.id,
                layer_order=0,
                layer_type="base",
                project_id=p1.id,
            )
        )
        session.commit()
        pid = profile.id
        p1_id = p1.id
        p2_id = p2.id

    with Session(engine) as session:
        add_addon_project(session, pid, p2_id)
        session.commit()
    with Session(engine) as session:
        add_addon_project(session, pid, p1_id)
        session.commit()

    with Session(engine) as session:
        layers = get_profile_layers(session, pid)
        assert len(layers) == 3
        addons = [l for l in layers if l.layer_type == "addon"]
        assert len(addons) == 2

    Base.metadata.drop_all(engine)
