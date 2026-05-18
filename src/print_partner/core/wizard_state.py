"""In-memory state for the new build wizard."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class WizardLayer:
    layer_type: str  # base | addon
    project_id: int
    layer_label: str
    included_match_keys: set[str] = field(default_factory=set)


@dataclass
class WizardState:
    mode: str = "new"  # new | load
    profile_id: int | None = None
    profile_name: str = ""
    base_project_id: int | None = None
    base_included: set[str] = field(default_factory=set)
    addons: list[WizardLayer] = field(default_factory=list)
    # Draft while configuring current addon before append
    draft_addon_project_id: int | None = None
    draft_addon_included: set[str] = field(default_factory=set)

    def all_layers(self) -> list[WizardLayer]:
        """Layers for finish; layer_label is set to {type}:{project_name} in wizard_finish."""
        layers: list[WizardLayer] = []
        if self.base_project_id is not None:
            layers.append(
                WizardLayer(
                    layer_type="base",
                    project_id=self.base_project_id,
                    layer_label="base",
                    included_match_keys=set(self.base_included),
                )
            )
        layers.extend(self.addons)
        return layers

    def commit_draft_addon(self, layer_label: str) -> None:
        if self.draft_addon_project_id is None:
            return
        self.addons.append(
            WizardLayer(
                layer_type="addon",
                project_id=self.draft_addon_project_id,
                layer_label=layer_label,
                included_match_keys=set(self.draft_addon_included),
            )
        )
        self.draft_addon_project_id = None
        self.draft_addon_included = set()

    def clear_draft_addon(self) -> None:
        self.draft_addon_project_id = None
        self.draft_addon_included = set()
