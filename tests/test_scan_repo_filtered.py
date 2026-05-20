from pathlib import Path

from print_partner.core.scanner import scan_repo


def test_scan_repo_all_when_rules_none(tmp_path: Path):
    root = tmp_path / "repo"
    (root / "parts").mkdir(parents=True)
    (root / "parts" / "a.stl").write_text("solid")
    (root / "b.stl").write_text("solid")
    all_parts = scan_repo(root, import_rules=None)
    assert len(all_parts) == 2


def test_scan_repo_filtered(tmp_path: Path):
    root = tmp_path / "repo"
    (root / "parts").mkdir(parents=True)
    (root / "parts" / "keep.stl").write_text("solid")
    (root / "parts" / "skip.stl").write_text("solid")
    (root / "other.stl").write_text("solid")
    parts = scan_repo(root, import_rules=["parts/keep.stl"])
    assert len(parts) == 1
    assert parts[0].relative_path == "parts/keep.stl"


def test_scan_repo_empty_rules(tmp_path: Path):
    root = tmp_path / "repo"
    root.mkdir()
    (root / "a.stl").write_text("solid")
    assert scan_repo(root, import_rules=[]) == []
