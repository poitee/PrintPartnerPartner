"""AI assistant configuration (non-secret settings in DB; API key in a local file)."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from print_partner.config import settings
from print_partner.db.session import get_setting_value, set_setting_value

_SETTING_PREFIX = "ai_"
_SECRETS_FILE = "ai_secrets.json"
_PROVIDERS = ("openai", "anthropic", "openai_compatible")


@dataclass
class AiConfig:
    enabled: bool = False
    provider: str = "openai"
    model: str = "gpt-4o-mini"
    base_url: str = ""

    def secrets_path(self) -> Path:
        return settings.data_dir / _SECRETS_FILE

    def is_configured(self) -> bool:
        return bool(self.enabled and load_api_key())


def load_ai_config() -> AiConfig:
    return AiConfig(
        enabled=_flag("enabled"),
        provider=get_setting_value(f"{_SETTING_PREFIX}provider") or "openai",
        model=get_setting_value(f"{_SETTING_PREFIX}model") or "gpt-4o-mini",
        base_url=get_setting_value(f"{_SETTING_PREFIX}base_url") or "",
    )


def save_ai_config(config: AiConfig) -> None:
    set_setting_value(f"{_SETTING_PREFIX}enabled", "1" if config.enabled else "0")
    set_setting_value(f"{_SETTING_PREFIX}provider", config.provider)
    set_setting_value(f"{_SETTING_PREFIX}model", config.model.strip())
    set_setting_value(f"{_SETTING_PREFIX}base_url", config.base_url.strip())


def load_api_key() -> str | None:
    path = settings.data_dir / _SECRETS_FILE
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    key = (data.get("api_key") or "").strip()
    return key or None


def save_api_key(api_key: str) -> None:
    settings.ensure_dirs()
    path = settings.data_dir / _SECRETS_FILE
    payload = {"api_key": api_key.strip()}
    path.write_text(json.dumps(payload), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def clear_api_key() -> None:
    path = settings.data_dir / _SECRETS_FILE
    if path.is_file():
        path.unlink(missing_ok=True)


def _flag(name: str) -> bool:
    return (get_setting_value(f"{_SETTING_PREFIX}{name}") or "").lower() in ("1", "true", "yes")


def config_for_dialog() -> dict:
    """Serialize for settings UI."""
    cfg = load_ai_config()
    return {**asdict(cfg), "has_api_key": bool(load_api_key()), "providers": list(_PROVIDERS)}
