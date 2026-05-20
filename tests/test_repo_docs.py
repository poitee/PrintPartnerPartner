"""Repository documentation discovery tests."""

from __future__ import annotations

from pathlib import Path

from print_partner.core.repo_docs import (
    DocRef,
    best_doc_for_relative_path,
    doc_breadcrumb,
    markdown_files_in_directory,
)


def test_markdown_files_in_directory_readme_first(tmp_path: Path):
    repo = tmp_path / "repo"
    (repo / "docs").mkdir(parents=True)
    (repo / "docs" / "notes.md").write_text("# Notes", encoding="utf-8")
    (repo / "docs" / "README.md").write_text("# Readme", encoding="utf-8")
    files = markdown_files_in_directory(repo, "docs")
    assert files[0].name == "README.md"
    assert any(p.name == "notes.md" for p in files)


def test_best_doc_for_relative_path_walks_up(tmp_path: Path):
    repo = tmp_path / "repo"
    sub = repo / "frame" / "back"
    sub.mkdir(parents=True)
    (sub / "README.md").write_text("# Back", encoding="utf-8")
    ref = best_doc_for_relative_path(repo, "frame/back/part.stl")
    assert ref is not None
    assert ref.title == "README.md"
    assert "frame/back" in ref.relative_path


def test_doc_breadcrumb():
    repo = Path("/data/repos/Micron")
    ref = DocRef(path=repo / "README.md", title="README.md", relative_path="README.md")
    assert "Micron" in doc_breadcrumb(repo, ref)
