"""Central logging configuration for Print Partner."""

from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from print_partner.config import settings

_LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"
_CONFIGURED = False


def configure_logging(
    *,
    level: int = logging.INFO,
    log_file: Path | None = None,
) -> None:
    """Configure root logger with stderr + rotating file handlers (idempotent)."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    settings.ensure_dirs()
    path = log_file or (settings.data_dir / "print-partner.log")

    root = logging.getLogger()
    root.setLevel(level)

    formatter = logging.Formatter(_LOG_FORMAT)

    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setLevel(level)
    stderr_handler.setFormatter(formatter)
    root.addHandler(stderr_handler)

    try:
        file_handler = RotatingFileHandler(
            path,
            maxBytes=2_000_000,
            backupCount=3,
            encoding="utf-8",
        )
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)
    except OSError:
        logging.getLogger(__name__).warning(
            "Could not open log file %s; logging to stderr only", path
        )

    _CONFIGURED = True
