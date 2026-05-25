"""Legal files present and vendor-neutral in notices."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = ("ambrosia", "west3d", "thunderkeys")


def test_license_and_notices_exist():
    assert (ROOT / "LICENSE").is_file()
    assert (ROOT / "THIRD_PARTY_NOTICES.md").is_file()
    assert (ROOT / "COMMERCIAL.md").is_file()


def test_legal_files_avoid_vendor_brands():
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md", "COMMERCIAL.md"):
        text = (ROOT / name).read_text(encoding="utf-8").lower()
        for word in FORBIDDEN:
            assert word not in text, f"{name} mentions {word}"


def test_pyproject_license_metadata():
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert "PolyForm-Noncommercial" in text
    assert "license-files" in text
