"""Wizard state unit tests."""

from print_partner.core.wizard_state import WizardLayer, WizardState


def test_all_layers_base_only():
    state = WizardState(profile_name="Test", base_project_id=1, base_included={"a.stl"})
    layers = state.all_layers()
    assert len(layers) == 1
    assert layers[0].layer_type == "base"
    assert layers[0].project_id == 1
    assert layers[0].included_match_keys == {"a.stl"}


def test_addon_ordering():
    state = WizardState(
        profile_name="Kit",
        base_project_id=1,
        base_included={"base.stl"},
    )
    state.addons.append(
        WizardLayer(
            layer_type="addon",
            project_id=2,
            layer_label="addon:extras",
            included_match_keys={"addon.stl"},
        )
    )
    state.draft_addon_project_id = 3
    state.draft_addon_included = {"draft.stl"}
    state.commit_draft_addon("addon:draft")
    layers = state.all_layers()
    assert len(layers) == 3
    assert layers[0].layer_type == "base"
    assert layers[1].project_id == 2
    assert layers[2].project_id == 3
    assert layers[2].included_match_keys == {"draft.stl"}


def test_clear_draft_addon():
    state = WizardState()
    state.draft_addon_project_id = 5
    state.draft_addon_included = {"x.stl"}
    state.clear_draft_addon()
    assert state.draft_addon_project_id is None
    assert state.draft_addon_included == set()
