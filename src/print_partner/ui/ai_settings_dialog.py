"""Configure optional AI assistant (provider, model, API key)."""

from __future__ import annotations

from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QVBoxLayout,
)

from print_partner.config import settings
from print_partner.core.ai_config import (
    clear_api_key,
    load_ai_config,
    load_api_key,
    save_ai_config,
    save_api_key,
)


class AiSettingsDialog(QDialog):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setWindowTitle("AI assistant settings")
        self.resize(480, 280)

        root = QVBoxLayout(self)
        privacy = QLabel(
            "When enabled, kit context (part list, README excerpts, your question) is sent to "
            "the configured API. Your API key is stored only in "
            f"{settings.data_dir / 'ai_secrets.json'} on this machine."
        )
        privacy.setWordWrap(True)
        privacy.setProperty("muted", True)
        root.addWidget(privacy)

        form = QFormLayout()
        self.enabled = QCheckBox("Enable AI assistant on Kit tab")
        form.addRow(self.enabled)

        self.provider = QComboBox()
        for value, label in [
            ("openai", "OpenAI"),
            ("anthropic", "Anthropic"),
            ("openai_compatible", "OpenAI-compatible (Ollama, LM Studio, …)"),
        ]:
            self.provider.addItem(label, value)
        form.addRow("Provider", self.provider)

        self.model = QLineEdit()
        self.model.setPlaceholderText("e.g. gpt-4o-mini or claude-3-5-haiku-20241022")
        form.addRow("Model", self.model)

        self.base_url = QLineEdit()
        self.base_url.setPlaceholderText("http://127.0.0.1:11434/v1 (compatible only)")
        form.addRow("Base URL", self.base_url)

        self.api_key = QLineEdit()
        self.api_key.setEchoMode(QLineEdit.Password)
        self.api_key.setPlaceholderText("Leave blank to keep existing key")
        form.addRow("API key", self.api_key)

        root.addLayout(form)

        buttons = QDialogButtonBox(
            QDialogButtonBox.Save | QDialogButtonBox.Cancel | QDialogButtonBox.Reset
        )
        buttons.accepted.connect(self._save)
        buttons.rejected.connect(self.reject)
        buttons.button(QDialogButtonBox.Reset).clicked.connect(self._clear_key)
        root.addWidget(buttons)

        self._load()

    def _load(self) -> None:
        cfg = load_ai_config()
        self.enabled.setChecked(cfg.enabled)
        idx = max(0, self.provider.findData(cfg.provider))
        self.provider.setCurrentIndex(idx)
        self.model.setText(cfg.model)
        self.base_url.setText(cfg.base_url)
        if load_api_key():
            self.api_key.setPlaceholderText("••••••••  (saved — enter new key to replace)")

    def _save(self) -> None:
        from print_partner.core.ai_config import AiConfig

        provider = self.provider.currentData() or "openai"
        cfg = AiConfig(
            enabled=self.enabled.isChecked(),
            provider=str(provider),
            model=self.model.text().strip() or "gpt-4o-mini",
            base_url=self.base_url.text().strip(),
        )
        save_ai_config(cfg)
        key = self.api_key.text().strip()
        if key:
            save_api_key(key)
        self.accept()

    def _clear_key(self) -> None:
        clear_api_key()
        self.api_key.clear()
        self.api_key.setPlaceholderText("API key cleared")
        QMessageBox.information(self, "AI settings", "API key removed from this machine.")
