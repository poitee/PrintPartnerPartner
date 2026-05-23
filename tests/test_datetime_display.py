from datetime import datetime, timezone

from print_partner.core.datetime_display import format_last_synced


def test_format_last_synced_none():
    text, tip = format_last_synced(None)
    assert text == "—"
    assert tip == ""


def test_format_last_synced_has_tooltip():
    dt = datetime(2026, 5, 18, 14, 30, tzinfo=timezone.utc)
    text, tip = format_last_synced(dt)
    assert "2026" in text
    assert tip
