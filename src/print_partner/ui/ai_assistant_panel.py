"""Optional AI assistant panel for the Kit tab."""

from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QDialog,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from print_partner.core.ai_client import AiResponse
from print_partner.core.ai_config import load_ai_config
from print_partner.ui.ai_suggestions_dialog import AiSuggestionsDialog
from print_partner.ui.ai_worker import AiWorker


class AiAssistantPanel(QWidget):
    apply_actions_requested = Signal(list)
    settings_requested = Signal()

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._context_provider = None
        self._snapshot_provider = None
        self._pending_response: AiResponse | None = None
        self._worker: AiWorker | None = None

        layout = QVBoxLayout(self)
        notice = QLabel(
            "Sends kit context and app capabilities to your API. Offline heuristics "
            "appear above the parts tree without a key."
        )
        notice.setProperty("muted", True)
        notice.setWordWrap(True)
        layout.addWidget(notice)

        self._snapshot = QLabel("")
        self._snapshot.setProperty("muted", True)
        layout.addWidget(self._snapshot)

        self._output = QTextEdit()
        self._output.setReadOnly(True)
        self._output.setMaximumHeight(160)
        self._output.setPlaceholderText("Ask a question about this kit…")
        layout.addWidget(self._output)

        prompt_row = QHBoxLayout()
        self._prompt = QTextEdit()
        self._prompt.setMaximumHeight(56)
        self._prompt.setPlaceholderText("e.g. Which optional parts should I exclude?")
        prompt_row.addWidget(self._prompt, 1)
        self._btn_ask = QPushButton("Ask")
        self._btn_ask.clicked.connect(self._ask)
        prompt_row.addWidget(self._btn_ask)
        layout.addLayout(prompt_row)

        action_row = QHBoxLayout()
        self._btn_apply = QPushButton("Review suggestions…")
        self._btn_apply.setEnabled(False)
        self._btn_apply.clicked.connect(self._review_and_apply)
        action_row.addWidget(self._btn_apply)
        self._btn_settings = QPushButton("Settings…")
        self._btn_settings.clicked.connect(self.settings_requested.emit)
        action_row.addStretch(1)
        action_row.addWidget(self._btn_settings)
        layout.addLayout(action_row)

        self._status = QLabel("")
        self._status.setProperty("muted", True)
        layout.addWidget(self._status)

    def set_context_provider(self, provider) -> None:
        self._context_provider = provider

    def set_snapshot_provider(self, provider) -> None:
        self._snapshot_provider = provider

    def refresh_context_snapshot(self) -> None:
        if self._snapshot_provider:
            try:
                self._snapshot.setText(self._snapshot_provider())
            except Exception:
                self._snapshot.setText("")
        else:
            self._snapshot.setText("")

    def refresh_enabled_state(self) -> None:
        cfg = load_ai_config()
        configured = cfg.is_configured()
        self.setEnabled(configured)
        if not cfg.enabled:
            self._status.setText("Disabled — enable in Settings")
        elif not configured:
            self._status.setText("Add an API key in Settings")
        else:
            self._status.setText(f"Provider: {cfg.provider} · model: {cfg.model}")
        self.refresh_context_snapshot()

    def _ask(self) -> None:
        if self._worker and self._worker.isRunning():
            return
        if not self._context_provider:
            QMessageBox.information(self, "AI", "Select a profile first.")
            return
        cfg = load_ai_config()
        if not cfg.is_configured():
            QMessageBox.information(self, "AI", "Configure an API key in Help → AI settings.")
            return
        question = self._prompt.toPlainText().strip()
        try:
            context = self._context_provider(question or None)
        except Exception as exc:  # noqa: BLE001
            QMessageBox.warning(self, "AI", f"Could not build context: {exc}")
            return
        self._btn_ask.setEnabled(False)
        self._status.setText("Waiting for model…")
        self._worker = AiWorker(cfg, context, parent=self)
        self._worker.finished_ok.connect(self._on_response)
        self._worker.error.connect(self._on_error)
        self._worker.finished.connect(lambda: self._btn_ask.setEnabled(True))
        self._worker.start()

    def _on_response(self, response: AiResponse) -> None:
        self._worker = None
        self._pending_response = response
        self._output.setPlainText(response.message)
        n = len(response.actions)
        self._btn_apply.setEnabled(n > 0)
        self._status.setText(
            f"Ready — {n} suggested action(s)" if n else "No actions suggested"
        )

    def _on_error(self, message: str) -> None:
        self._worker = None
        self._status.setText("Error")
        QMessageBox.warning(self, "AI", message)

    def _review_and_apply(self) -> None:
        if not self._pending_response or not self._pending_response.actions:
            return
        dlg = AiSuggestionsDialog(self._pending_response.actions, parent=self)
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return
        selected = dlg.selected_actions()
        if not selected:
            return
        self.apply_actions_requested.emit(selected)
        self._pending_response = None
        self._btn_apply.setEnabled(False)
        self._status.setText("Suggestions applied")

    def shutdown(self) -> None:
        if self._worker and self._worker.isRunning():
            self._worker.wait(3000)
        self._worker = None
