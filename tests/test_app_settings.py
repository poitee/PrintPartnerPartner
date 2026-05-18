from print_partner.db.models import Base
from print_partner.db.session import (
    get_engine,
    get_setting,
    get_setting_value,
    init_db,
    set_setting,
    set_setting_value,
)
from sqlalchemy.orm import Session


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
