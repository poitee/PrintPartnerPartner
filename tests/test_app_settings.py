import base64
import json

from PySide6.QtCore import QByteArray
from sqlalchemy.orm import Session

from print_partner.db.models import Base, BuildProfile
from print_partner.db.session import (
    db_session,
    get_engine,
    get_setting,
    get_setting_value,
    init_db,
    set_setting,
    set_setting_value,
)


def test_app_settings_roundtrip():
    init_db()
    engine = get_engine()
    with Session(engine) as session:
        set_setting(session, "last_profile_id", "42")
        session.commit()
        assert get_setting(session, "last_profile_id") == "42"
        assert get_setting(session, "missing", "default") == "default"

    set_setting_value("last_tab_index", "1")
    assert get_setting_value("last_tab_index") == "1"

    Base.metadata.drop_all(engine)


def test_app_settings_persist_across_sessions():
    init_db()
    engine = get_engine()
    set_setting_value("last_profile_id", "7")
    set_setting_value("last_tab_index", "1")
    set_setting_value(
        "profile_filters:7",
        json.dumps({"status": "added", "role": "accent", "filament": "", "included_idx": 1}),
    )
    geom = QByteArray(b"fake-window-geometry-bytes")
    set_setting_value("window_geometry", base64.standard_b64encode(geom.data()).decode("ascii"))

    assert get_setting_value("last_profile_id") == "7"
    assert get_setting_value("last_tab_index") == "1"
    assert json.loads(get_setting_value("profile_filters:7") or "{}")["role"] == "accent"
    restored = base64.standard_b64decode(get_setting_value("window_geometry") or "")
    assert restored == b"fake-window-geometry-bytes"

    Base.metadata.drop_all(engine)


def test_stale_last_profile_id_detected():
    from print_partner.db.session import list_profiles

    init_db()
    engine = get_engine()
    with db_session() as session:
        session.add(BuildProfile(name="Only"))
        session.flush()
        pid = session.query(BuildProfile).first().id
    set_setting_value("last_profile_id", str(pid + 9999))
    with db_session() as session:
        profile_ids = [p.id for p in list_profiles(session)]
    assert int(get_setting_value("last_profile_id") or "0") not in profile_ids

    Base.metadata.drop_all(engine)
