"""Resolve paths to LICENSE and notices in dev and PyInstaller bundles."""

from __future__ import annotations

import sys
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def bundle_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return repo_root()


def legal_file_path(name: str) -> Path:
    return bundle_root() / name


def read_legal_file(name: str) -> str:
    path = legal_file_path(name)
    if not path.is_file():
        return f"(File not found: {path})"
    return path.read_text(encoding="utf-8")
