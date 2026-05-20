import json

from sqlalchemy.orm import Session

from print_partner.db.models import Base, Project
from print_partner.db.session import get_engine, init_db


def test_project_imported_paths_column(tmp_path):
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        session.add(
            Project(
                name="TestRepo",
                url="https://example.com/repo.git",
                imported_paths=json.dumps(["parts/one.stl"]),
            )
        )
        session.commit()
        proj = session.query(Project).filter_by(name="TestRepo").one()
        assert json.loads(proj.imported_paths or "[]") == ["parts/one.stl"]
    Base.metadata.drop_all(engine)
