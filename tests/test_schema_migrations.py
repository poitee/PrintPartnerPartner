"""Schema version tracking for incremental DB migrations."""

from sqlalchemy import text

from print_partner.db.session import (
    CURRENT_SCHEMA_VERSION,
    SCHEMA_VERSION_KEY,
    get_engine,
    get_schema_version,
    init_db,
)


def test_fresh_db_schema_version() -> None:
    init_db()
    assert get_schema_version() == CURRENT_SCHEMA_VERSION


def test_init_db_idempotent() -> None:
    init_db()
    v1 = get_schema_version()
    init_db()
    assert get_schema_version() == v1 == CURRENT_SCHEMA_VERSION


def test_schema_version_stored_in_app_settings() -> None:
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT value FROM app_settings WHERE key = :key"),
            {"key": SCHEMA_VERSION_KEY},
        ).fetchone()
    assert row is not None
    assert int(row[0]) == CURRENT_SCHEMA_VERSION
