"""Repository list export/import."""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from print_partner.core.repo_list_io import (
    REPO_LIST_FORMAT,
    import_repo_list_file,
    projects_to_export_list,
)
from print_partner.db.models import Base, Project
from print_partner.db.session import get_engine, init_db


def test_export_and_import_repo_list(tmp_path) -> None:
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        session.add(
            Project(name="alpha", url="https://github.com/a/a.git", branch="main")
        )
        session.commit()
        rows = projects_to_export_list(session)
        assert len(rows) == 1
        path = tmp_path / "repos.json"
        path.write_text(
            json.dumps(
                {
                    "format": REPO_LIST_FORMAT,
                    "version": 1,
                    "projects": rows,
                }
            ),
            encoding="utf-8",
        )
        session.query(Project).delete()
        session.commit()
        count = import_repo_list_file(session, path)
        session.commit()
        assert count == 1
        restored = session.query(Project).filter(Project.name == "alpha").first()
        assert restored is not None
        assert restored.url.endswith("a.git")

    Base.metadata.drop_all(engine)
