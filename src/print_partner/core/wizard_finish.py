"""Persist wizard selections to database (no Qt)."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from print_partner.core.merge import merge_layers
from print_partner.core.scanner import scan_repo
from print_partner.core.wizard_state import WizardLayer, WizardState
from print_partner.db.models import BuildProfile, Part, ProfileLayer, Project
from print_partner.db.session import save_merge_result


def finish_wizard_build(session: Session, state: WizardState) -> int:
    """
    Create or update profile, layers, merged parts with wizard inclusion.
    Returns profile_id.
    """
    if not state.profile_name.strip():
        raise ValueError("Build name is required")
    if state.base_project_id is None:
        raise ValueError("Base project is required")

    profile: BuildProfile | None = None
    if state.mode == "load" and state.profile_id is not None:
        profile = session.get(BuildProfile, state.profile_id)
    if profile is None:
        existing = session.scalars(
            select(BuildProfile).where(BuildProfile.name == state.profile_name.strip())
        ).first()
        if existing and state.mode == "new":
            raise ValueError(f"Build already exists: {state.profile_name}")
        profile = BuildProfile(name=state.profile_name.strip())
        session.add(profile)
        session.flush()
    else:
        profile.name = state.profile_name.strip()

    profile_id = profile.id
    session.execute(delete(ProfileLayer).where(ProfileLayer.profile_id == profile_id))

    layer_scans: list[tuple[str, list]] = []
    wizard_layers = state.all_layers()
    included_by_label: dict[str, set[str]] = {}

    for order, layer in enumerate(wizard_layers):
        proj = session.get(Project, layer.project_id)
        if not proj or not proj.local_path:
            raise ValueError(f"Project not synced: {layer.project_id}")
        label = f"{layer.layer_type}:{proj.name}"
        layer.layer_label = label
        included_by_label[label] = set(layer.included_match_keys)
        scanned = scan_repo(Path(proj.local_path), label)
        layer_scans.append((label, scanned))

        session.add(
            ProfileLayer(
                profile_id=profile_id,
                layer_order=order,
                layer_type=layer.layer_type,
                project_id=layer.project_id,
            )
        )

    result = merge_layers(layer_scans, existing={})
    save_merge_result(session, profile_id, result)

    for part in session.scalars(select(Part).where(Part.profile_id == profile_id)).all():
        keys = included_by_label.get(part.source_layer)
        if keys is None:
            included = False
        else:
            included = part.match_key in keys
        part.included = included
        if not included:
            part.status = "excluded"

    session.flush()
    return profile_id


def load_wizard_state_from_profile(session: Session, profile_id: int) -> WizardState:
    """Populate wizard state from an existing build for re-edit."""
    profile = session.get(BuildProfile, profile_id)
    if not profile:
        raise ValueError("Profile not found")
    state = WizardState(
        mode="load",
        profile_id=profile_id,
        profile_name=profile.name,
    )
    layers = list(
        session.scalars(
            select(ProfileLayer)
            .where(ProfileLayer.profile_id == profile_id)
            .order_by(ProfileLayer.layer_order)
        ).all()
    )
    parts = list(session.scalars(select(Part).where(Part.profile_id == profile_id)).all())
    included_by_layer: dict[str, set[str]] = {}
    for part in parts:
        if part.included:
            included_by_layer.setdefault(part.source_layer, set()).add(part.match_key)

    for layer in layers:
        if layer.project_id is None:
            continue
        proj = session.get(Project, layer.project_id)
        label = f"{layer.layer_type}:{proj.name}" if proj else layer.layer_type
        keys = included_by_layer.get(label, set())
        if layer.layer_type == "base":
            state.base_project_id = layer.project_id
            state.base_included = set(keys)
        else:
            state.addons.append(
                WizardLayer(
                    layer_type="addon",
                    project_id=layer.project_id,
                    layer_label=label,
                    included_match_keys=set(keys),
                )
            )
    return state
