"""Tests for profile_ops."""

from __future__ import annotations

from print_partner.core.profile_ops import (
    duplicate_profile,
    rename_profile,
    set_profile_order_number,
)
from print_partner.db.models import Base, BuildProfile, Part, ProfileLayer, Project
from print_partner.db.session import get_engine, init_db
from sqlalchemy.orm import Session


def test_profile_ops_rename_order_duplicate():
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="ops-src")
        session.add(profile)
        session.flush()
        proj = Project(name="ops-proj", url="https://example.com", local_path="/tmp")
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
                match_key="x.stl",
                relative_path="x.stl",
                filename="x.stl",
                source_layer="base:ops-proj",
            )
        )
        session.commit()
        src_id = profile.id

    with Session(engine) as session:
        set_profile_order_number(session, src_id, "ORD-42")
        rename_profile(session, src_id, "ops-renamed")
        session.commit()

    with Session(engine) as session:
        p = session.get(BuildProfile, src_id)
        assert p.name == "ops-renamed"
        assert p.order_number == "ORD-42"
        new_id = duplicate_profile(session, src_id, "ops-copy")
        session.commit()
        copy = session.get(BuildProfile, new_id)
        assert copy.order_number == "ORD-42"
        parts = session.query(Part).filter(Part.profile_id == new_id).all()
        assert len(parts) == 1

    Base.metadata.drop_all(engine)
