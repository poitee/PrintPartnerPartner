"""Build reference layer context for wizard addon curation."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from print_partner.core.import_rules import import_rules_for_project
from print_partner.core.scanner import ScannedPart, scan_repo
from print_partner.core.wizard_state import WizardState
from print_partner.db.models import Project


def reference_layers_for_state(session: Session, state: WizardState) -> list[tuple[str, list[ScannedPart], set[str]]]:
    layers: list[tuple[str, list[ScannedPart], set[str]]] = []
    if state.base_project_id is not None:
        proj = session.get(Project, state.base_project_id)
        if proj and proj.local_path:
            label = f"base:{proj.name}"
            rules = import_rules_for_project(proj.imported_paths)
            scanned = scan_repo(Path(proj.local_path), label, import_rules=rules)
            layers.append((label, scanned, set(state.base_included)))
    for addon in state.addons:
        proj = session.get(Project, addon.project_id)
        if not proj or not proj.local_path:
            continue
        label = addon.layer_label or f"addon:{proj.name}"
        rules = import_rules_for_project(proj.imported_paths)
        scanned = scan_repo(Path(proj.local_path), label, import_rules=rules)
        layers.append((label, scanned, set(addon.included_match_keys)))
    return layers
