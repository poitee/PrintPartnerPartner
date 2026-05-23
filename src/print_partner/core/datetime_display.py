"""Human-readable datetime formatting for UI."""

from __future__ import annotations

from datetime import datetime, timezone


def format_last_synced(dt: datetime | None) -> tuple[str, str]:
    """Return (display text, tooltip ISO or empty)."""
    if dt is None:
        return "—", ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone()
    display = local.strftime("%b %d, %Y %I:%M %p").replace(" 0", " ")
    tooltip = dt.isoformat()
    return display, tooltip
