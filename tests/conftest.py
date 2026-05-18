"""Isolate tests from the user's live ~/.print-partner database."""

from __future__ import annotations

import pytest

from print_partner.config import settings
from print_partner.db.session import init_db


@pytest.fixture(autouse=True)
def _isolated_print_partner_data_dir(monkeypatch, tmp_path):
    """
    Every test uses its own temp data directory.

    Without this, tests that call Base.metadata.drop_all(get_engine())
    wipe the real SQLite file at ~/.print-partner/print_partner.db.
    """
    data = tmp_path / "print-partner-test"
    monkeypatch.setattr(settings, "data_dir", data)
    settings.ensure_dirs()
    init_db()
    yield data
