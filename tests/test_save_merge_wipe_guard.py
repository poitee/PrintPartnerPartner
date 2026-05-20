import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from print_partner.core.merge import MergeResult
from print_partner.db.models import Base, BuildProfile, Part
from print_partner.db.session import (
    MergeWouldWipeProfileError,
    get_engine,
    init_db,
    save_merge_result,
)


def test_save_merge_refuses_empty_result_when_parts_exist():
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="wipe-guard")
        session.add(profile)
        session.flush()
        session.add(
            Part(
                profile_id=profile.id,
                match_key="a.stl",
                relative_path="a.stl",
                filename="a.stl",
                source_layer="base",
            )
        )
        session.commit()
        with pytest.raises(MergeWouldWipeProfileError):
            save_merge_result(session, profile.id, MergeResult(parts=[]))
        still = session.scalars(select(Part).where(Part.profile_id == profile.id)).first()
        assert still is not None
    Base.metadata.drop_all(engine)
