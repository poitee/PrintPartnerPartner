from pathlib import Path

from print_partner.core.export_html import export_path_for_profile, export_profile_html
from print_partner.core.merge import MergePart


def test_export_path_for_profile():
    path = export_path_for_profile("My Kit Name", Path("/tmp/exports"))
    assert path == Path("/tmp/exports/My_Kit_Name.html")


def test_export_html_repo_and_folder_sections(tmp_path: Path):
    parts = [
        MergePart(
            match_key="parts/widget.stl",
            relative_path="parts/widget.stl",
            filename="widget.stl",
            source_layer="addon:Boop",
            status="added",
            role="accent",
            quantity_auto=2,
            part_slug="widget",
            included=True,
            filament_hex="#ff0000",
            filament_display="Red PLA",
        ),
        MergePart(
            match_key="frame.stl",
            relative_path="frame.stl",
            filename="frame.stl",
            source_layer="base:Micron",
            status="base",
            role="primary",
            quantity_auto=1,
            part_slug="frame",
            included=True,
        ),
        MergePart(
            match_key="parts/bracket.stl",
            relative_path="parts/bracket.stl",
            filename="bracket.stl",
            source_layer="base:Micron",
            status="base",
            role="primary",
            quantity_auto=1,
            part_slug="bracket",
            included=True,
        ),
    ]
    out = tmp_path / "sheet.html"
    export_profile_html(
        "Test Build",
        parts,
        out,
        order_number="PO-100",
        profile_id=7,
        completed_by_match_key={
            "parts/widget.stl": [True, False],
            "frame.stl": [False],
            "parts/bracket.stl": [True],
        },
    )
    html = out.read_text(encoding="utf-8")
    assert "Order #:" in html
    assert "PO-100" in html
    assert 'class="repo-section">base:Micron</h2>' in html
    assert 'class="repo-section">addon:Boop</h2>' in html
    assert html.index("base:Micron") < html.index("addon:Boop")
    assert 'class="folder-section">parts</h3>' in html
    assert 'class="folder-section">(root)</h3>' in html
    assert "accent-color: #ff0000" in html
    assert "print-partner-7-" in html
    assert html.count('type="checkbox"') >= 4
    assert "role-section" not in html


def test_export_html_passes_filament_hex_to_thumbnails(tmp_path: Path, monkeypatch):
    captured: list[str | None] = []

    def fake_ensure_thumbnail(stl_path, export_dir, role, *, mesh_hex=None, **kwargs):
        captured.append(mesh_hex)
        return None

    monkeypatch.setattr(
        "print_partner.core.export_html.ensure_thumbnail",
        fake_ensure_thumbnail,
    )
    stl = tmp_path / "widget.stl"
    stl.write_text("solid")
    parts = [
        MergePart(
            match_key="parts/widget.stl",
            relative_path="parts/widget.stl",
            filename="widget.stl",
            source_layer="addon:Boop",
            status="added",
            role="accent",
            quantity_auto=1,
            part_slug="widget",
            included=True,
            filament_hex="#00aaff",
            filament_display="Blue PLA",
            absolute_path=stl,
        ),
    ]
    export_profile_html("Color Test", parts, tmp_path / "out.html")
    assert captured == ["#00aaff"]
