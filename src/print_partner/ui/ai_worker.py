"""Background thread for AI API calls."""

from __future__ import annotations

import logging

from PySide6.QtCore import QThread, Signal

from print_partner.core.ai_client import AiClientError, complete
from print_partner.core.ai_config import AiConfig, load_api_key

logger = logging.getLogger(__name__)


class AiWorker(QThread):
    finished_ok = Signal(object)  # AiResponse
    error = Signal(str)

    def __init__(
        self,
        config: AiConfig,
        user_context: str,
        parent=None,
    ) -> None:
        super().__init__(parent)
        self._config = config
        self._user_context = user_context

    def run(self) -> None:
        key = load_api_key()
        if not key:
            self.error.emit("No API key configured. Use AI Settings in the Help menu.")
            return
        try:
            response = complete(self._config, key, self._user_context)
        except AiClientError as exc:
            self.error.emit(str(exc))
            return
        except Exception as exc:  # noqa: BLE001 — surface unexpected errors in UI
            logger.exception("AI request failed")
            self.error.emit(str(exc))
            return
        self.finished_ok.emit(response)
