from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PRINT_PARTNER_")

    data_dir: Path = Path.home() / ".print-partner"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "print_partner.db"

    @property
    def repos_dir(self) -> Path:
        return self.data_dir / "repos"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    @property
    def thumbs_dir(self) -> Path:
        return self.data_dir / "thumbs"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.repos_dir.mkdir(parents=True, exist_ok=True)
        self.exports_dir.mkdir(parents=True, exist_ok=True)
        self.thumbs_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
