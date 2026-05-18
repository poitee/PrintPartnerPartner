"""Local folder import tests."""

from pathlib import Path

import pytest

from print_partner.config import settings
from print_partner.core.project_import import import_local_folder
from print_partner.db.session import init_db


@pytest.fixture
def isolated_data(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.ensure_dirs()
    init_db()
    return tmp_path


def test_import_local_folder_copies_into_repos(isolated_data):
    source = isolated_data / "source_kit"
    source.mkdir()
    (source / "part.stl").write_bytes(b"solid fake")

    result = import_local_folder("my-kit", source)
    dest = settings.repos_dir / "my-kit"

    assert dest.is_dir()
    assert (dest / "part.stl").is_file()
    assert result.local_path == dest
    assert result.last_synced_at is not None
