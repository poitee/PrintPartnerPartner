from print_partner.core.print_progress import print_units_by_part_id
from print_partner.db.models import Base, BuildProfile, Part, PrintProgress
from print_partner.db.session import get_engine, init_db
from sqlalchemy.orm import Session


def test_print_units_by_part_id_single_query_pattern():
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        profile = BuildProfile(name="units-batch")
        session.add(profile)
        session.flush()
        part = Part(
            profile_id=profile.id,
            match_key="a.stl",
            relative_path="a.stl",
            filename="a.stl",
            source_layer="base",
            quantity_effective=2,
        )
        session.add(part)
        session.flush()
        session.add(PrintProgress(part_id=part.id, unit_index=0, completed=True))
        session.add(PrintProgress(part_id=part.id, unit_index=1, completed=False))
        session.commit()
        units = print_units_by_part_id(session, profile.id)
        assert units[part.id] == [True, False]
    Base.metadata.drop_all(engine)
