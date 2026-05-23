import uuid

from print_partner.db.models import BuildProfile, Part
from print_partner.db.session import db_session, profile_part_counts


def test_profile_part_counts():
    name = f"counts-{uuid.uuid4().hex[:8]}"
    with db_session() as session:
        p = BuildProfile(name=name)
        session.add(p)
        session.flush()
        pid = p.id
        session.add_all(
            [
                Part(
                    profile_id=pid,
                    filename="x.stl",
                    source_layer="base:r",
                    match_key="x",
                    relative_path="x.stl",
                    included=True,
                    status="base",
                ),
                Part(
                    profile_id=pid,
                    filename="y.stl",
                    source_layer="base:r",
                    match_key="y",
                    relative_path="y.stl",
                    included=False,
                    status="excluded",
                ),
            ]
        )
        session.flush()
        counts = profile_part_counts(session)
    assert counts[pid] == (2, 1)
