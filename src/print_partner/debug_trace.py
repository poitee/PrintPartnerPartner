"""Session debug logging (NDJSON) for debug mode."""

from __future__ import annotations

import json
import time
from pathlib import Path

_DEBUG_LOG = Path(__file__).resolve().parents[2] / ".cursor" / "debug-ae4f75.log"
_SESSION_ID = "ae4f75"


def debug_log(
    location: str,
    message: str,
    data: dict | None = None,
    *,
    hypothesis_id: str = "",
    run_id: str = "pre-fix",
) -> None:
    # region agent log
    try:
        payload = {
            "sessionId": _SESSION_ID,
            "timestamp": int(time.time() * 1000),
            "location": location,
            "message": message,
            "data": data or {},
            "hypothesisId": hypothesis_id,
            "runId": run_id,
        }
        _DEBUG_LOG.parent.mkdir(parents=True, exist_ok=True)
        with _DEBUG_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except OSError:
        pass
    # endregion
