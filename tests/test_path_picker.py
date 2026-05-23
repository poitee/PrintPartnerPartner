"""Tests for directory path resolution (no Qt UI)."""

from pathlib import Path

import pytest

from print_partner.ui.path_picker import resolve_directory_input


def test_resolve_directory_input_empty() -> None:
    with pytest.raises(ValueError, match="Enter a folder"):
        resolve_directory_input("")


def test_resolve_directory_input_missing(tmp_path: Path) -> None:
    missing = tmp_path / "nope"
    with pytest.raises(ValueError, match="Not a folder"):
        resolve_directory_input(str(missing))


def test_resolve_directory_input_ok(tmp_path: Path) -> None:
    folder = tmp_path / "stls"
    folder.mkdir()
    resolved = resolve_directory_input(str(folder))
    assert resolved == folder.resolve()
