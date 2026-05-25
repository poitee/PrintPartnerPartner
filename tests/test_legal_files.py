"""Legal files present and vendor-neutral in notices."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = ("ambrosia", "west3d", "thunderkeys")


def test_license_and_notices_exist():
    assert (ROOT / "LICENSE").is_file()
    assert (ROOT / "LICENSE-SUMMARY.md").is_file()
    assert (ROOT / "THIRD_PARTY_NOTICES.md").is_file()
    assert (ROOT / "COMMERCIAL.md").is_file()
    assert not (ROOT / "LICENSE.md").exists()
    assert not (ROOT / "docs" / "LICENSING.md").exists()


def test_legal_files_avoid_vendor_brands():
    for name in ("LICENSE", "LICENSE-SUMMARY.md", "THIRD_PARTY_NOTICES.md", "COMMERCIAL.md"):
        text = (ROOT / name).read_text(encoding="utf-8").lower()
        for word in FORBIDDEN:
            assert word not in text, f"{name} mentions {word}"


def test_license_is_polyform_noncommercial():
    text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert "PolyForm Noncommercial License 1.0.0" in text
    assert "polyformproject.org/licenses/noncommercial" in text


def test_summary_explains_polyform():
    text = (ROOT / "LICENSE-SUMMARY.md").read_text(encoding="utf-8")
    assert "PolyForm Noncommercial" in text
    assert "noncommercial" in text.lower()
    assert "COMMERCIAL.md" in text
    assert "share-alike" in text.lower() or "share copies" in text.lower()
    assert "print business" in text.lower()


def test_commercial_explains_software_vs_prints():
    text = (ROOT / "COMMERCIAL.md").read_text(encoding="utf-8")
    assert "physical parts" in text.lower()
    assert "PolyForm" in text
    assert "@" not in text


def test_pyproject_license_metadata():
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert "PolyForm-Noncommercial-1.0.0" in text
    assert "LICENSE-SUMMARY.md" in text
