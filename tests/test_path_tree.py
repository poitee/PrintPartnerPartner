"""Path tree builder unit tests."""

from print_partner.core.path_tree import build_path_tree, iter_path_segments


def test_iter_path_segments():
    assert iter_path_segments("a.stl") == ([], "a.stl")
    assert iter_path_segments("frame/back/a.stl") == (["frame", "back"], "a.stl")


def test_build_path_tree_nested():
    root = build_path_tree(["frame/a.stl", "frame/b.stl", "other/c.stl"])
    assert "frame" in root.subdirs
    assert "other" in root.subdirs
    assert len(root.subdirs["frame"].files) == 2
    assert root.subdirs["other"].files == ["other/c.stl"]
