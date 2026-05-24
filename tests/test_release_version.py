"""Tests for release version verification scripts."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load_changelog_module():
    path = ROOT / "packaging" / "changelog_release_body.py"
    spec = importlib.util.spec_from_file_location("changelog_release_body", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_extract_changelog_body_020():
    mod = _load_changelog_module()
    body = mod.extract_changelog_body("0.2.0")
    assert body is not None
    assert "Kit sharing" in body


def test_extract_changelog_body_missing():
    mod = _load_changelog_module()
    assert mod.extract_changelog_body("99.99.99") is None


def test_verify_release_version_ok():
    script = ROOT / "packaging" / "verify_release_version.py"
    proc = subprocess.run(
        [sys.executable, str(script), "0.2.0"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr


def test_verify_release_version_mismatch():
    script = ROOT / "packaging" / "verify_release_version.py"
    proc = subprocess.run(
        [sys.executable, str(script), "99.99.99"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 1
