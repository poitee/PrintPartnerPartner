from print_partner.core.ai_client import action_summary, parse_ai_response


def test_parse_include_exclude():
    raw = '{"message": "Exclude spares.", "actions": [{"type":"exclude","part_id":3,"reason":"optional"}]}'
    resp = parse_ai_response(raw)
    assert resp.message == "Exclude spares."
    assert len(resp.actions) == 1
    assert resp.actions[0].action_type == "exclude"
    assert resp.actions[0].part_id == 3


def test_parse_set_filament():
    raw = '{"message": "ok", "actions": [{"type":"set_filament","part_id":1,"filament_color_id":"amb-1","reason":"primary"}]}'
    resp = parse_ai_response(raw)
    assert resp.actions[0].filament_color_id == "amb-1"


def test_parse_navigate():
    raw = '{"message": "go", "actions": [{"type":"navigate","target":"review","reason":"check"}]}'
    resp = parse_ai_response(raw)
    assert resp.actions[0].target == "review"
    assert "review" in action_summary(resp.actions[0]).lower()


def test_parse_legacy_include_action_key():
    raw = '{"message": "x", "actions": [{"part_id":2,"action":"include","reason":"y"}]}'
    resp = parse_ai_response(raw)
    assert resp.actions[0].action == "include"
