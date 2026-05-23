from print_partner.core.import_rules import (
    parse_import_rules_json,
    path_matches_rules,
    serialize_import_rules,
)


def test_path_matches_file_and_folder():
    rules = ["parts/accent/", "frame.stl"]
    assert path_matches_rules("parts/accent/bracket.stl", rules)
    assert path_matches_rules("frame.stl", rules)
    assert not path_matches_rules("parts/primary/block.stl", rules)


def test_parse_legacy_null():
    assert parse_import_rules_json(None) is None


def test_parse_empty_opt_in():
    assert parse_import_rules_json("[]") == []


def test_serialize_roundtrip():
    raw = serialize_import_rules(["parts/a/", "b.stl"])
    assert parse_import_rules_json(raw) == ["parts/a/", "b.stl"]
