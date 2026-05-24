"""Parts table, filters, filament, and selection for ProfileComposer."""

from __future__ import annotations

import json
from pathlib import Path

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import QMenu, QMessageBox, QProgressDialog

from print_partner.core.ambrosia_catalog import (
    AmbrosiaCatalog,
    catalog_status_text,
    invalidate_catalog_cache,
    load_catalog,
)
from print_partner.core.filament_color_resolve import resolve_part_filament_hex
from print_partner.core.part_paths import build_profile_stl_index, resolve_part_stl_path
from print_partner.core.parts_tree import repo_name_from_source_layer
from print_partner.core.print_checklist import enrich_thumbnail_paths
from print_partner.core.print_progress import mark_part_printed, print_units_by_part_id
from print_partner.core.thumbnails import invalidate_global_thumbnails
from print_partner.db.models import Part, Project
from print_partner.db.session import (
    bulk_set_filament_color,
    db_session,
    get_profile_layers,
    get_profile_parts,
    get_setting_value,
    part_to_display_dict,
    set_setting_value,
)
from print_partner.ui.catalog_sync_worker import CatalogSyncWorker


class PartsViewMixin:
    """Mixin: parts UI, filters, filament assignment."""

    def _apply_compose_parts_ui(self, part_dicts: list[dict]) -> None:
        filtered_dicts: list[dict] = []
        filament_f = self.filament_filter.currentData()
        for row in part_dicts:
            if self._status_filter and row["status"] != self._status_filter:
                continue
            role_f = self.role_combo.currentText()
            if role_f and row["role"] != role_f:
                continue
            if filament_f == "__unset__" and row.get("filament_color_id"):
                continue
            if filament_f and filament_f not in ("", "__unset__") and row.get("filament_color_id") != filament_f:
                continue
            inc_idx = self.included_only.currentIndex()
            if inc_idx == 1 and not row["included"]:
                continue
            if inc_idx == 2 and row["included"]:
                continue
            filtered_dicts.append(row)
        self._visible_part_ids = {d["id"] for d in filtered_dicts}
        self.parts_panel.load_parts(
            part_dicts,
            filtered_dicts,
            readme_repo_paths=self._cached_readme_paths,
            reference_layers=self._cached_reference_layers,
        )
        self._update_verify_summary(part_dicts)

    def _schedule_load_parts(self) -> None:
        self._load_parts_timer.start()

    def _load_parts(self) -> None:
        self._schedule_load_parts()

    def _apply_view_state(self) -> None:
        is_checkoff = self._top_mode == "checkoff"
        is_compose = self._top_mode == "kit" and self._kit_sub_mode == "compose"
        is_review = self._top_mode == "kit" and self._kit_sub_mode == "review"

        if is_checkoff:
            self._action_stack.setCurrentIndex(2)
        elif is_review:
            self._action_stack.setCurrentIndex(1)
        else:
            self._action_stack.setCurrentIndex(0)

        self.layers_panel.setVisible(is_compose)
        self.catalog_status.setVisible(False)
        self.thumb_status.setVisible(False)
        self._update_header_status()
        self._update_breadcrumb()
        if is_checkoff:
            self._update_checkoff_progress()
        self._filters_group.setVisible(is_compose)
        self._splitter.setVisible(True)
        self._splitter_right.setVisible(is_compose or is_checkoff)
        self._editor_host.setVisible(is_compose)
        self._verify_summary.setVisible(is_review)
        self._inspector_tabs.setVisible(is_compose or is_checkoff)
        if is_compose:
            self.ai_panel.refresh_enabled_state()
            self.ai_panel.refresh_context_snapshot()

        if is_checkoff:
            self.parts_panel.set_panel_mode("checkoff")
            self._splitter.setSizes([700, 380])
        elif is_review:
            self.parts_panel.set_panel_mode("verify_chosen")
            self._update_verify_summary()
        else:
            self.parts_panel.set_panel_mode("build")

    def _build_assign_filament_menu(self) -> QMenu:
        menu = QMenu(self)
        for role in ("primary", "accent", "clear", "opaque"):
            action = menu.addAction(f"All {role} parts")
            action.triggered.connect(lambda checked=False, r=role: self._bulk_assign_filament(r))
        return menu

    def _selected_filament_color_id(self) -> str | None:
        return self.filament_picker.selected_color_id()

    def _preview_mesh_hex(self) -> str:
        """Filament color for the 3D preview (picker selection, not yet saved)."""
        return self.filament_picker.mesh_hex()

    def _on_preview_color_changed(self) -> None:
        if self.role_edit.signalsBlocked():
            return
        if self._selected_part_id() is None:
            return
        self._refresh_stl_preview()

    def _refresh_ambrosia_colors(self) -> None:
        if self._catalog_worker and self._catalog_worker.isRunning():
            return
        progress = QProgressDialog("Syncing West3D Ambrosia colors…", "Cancel", 0, 100, self)
        progress.setWindowModality(Qt.WindowModal)
        progress.setMinimumDuration(0)
        progress.setValue(0)

        self._catalog_worker = CatalogSyncWorker(parent=self)

        def on_progress(done: int, total: int) -> None:
            progress.setMaximum(max(1, total))
            progress.setLabelText(f"Sampling swatch colors ({done}/{total})…")
            progress.setValue(done)
            if progress.wasCanceled() and self._catalog_worker:
                self._catalog_worker.cancel()

        def on_finished(catalog: AmbrosiaCatalog) -> None:
            progress.close()
            self._catalog_worker = None
            invalidate_catalog_cache()
            self._catalog = load_catalog()
            self.catalog_status.setText(catalog_status_text(self._catalog))
            self.filament_picker.set_catalog(self._catalog)
            self._rebuild_filament_filter()
            from print_partner.ui.toast import show_toast

            show_toast(self, f"Loaded {len(self._catalog.colors)} Ambrosia colors.")

        def on_error(message: str) -> None:
            progress.close()
            self._catalog_worker = None
            QMessageBox.critical(self, "Ambrosia sync failed", message)

        def on_worker_finished() -> None:
            if self._catalog_worker and not self._catalog_worker.isRunning():
                self._catalog_worker = None

        self._catalog_worker.progress.connect(on_progress)
        self._catalog_worker.finished_ok.connect(on_finished)
        self._catalog_worker.error.connect(on_error)
        self._catalog_worker.finished.connect(on_worker_finished)
        self._catalog_worker.start()

    def _rebuild_filament_filter(self, part_dicts: list[dict] | None = None) -> None:
        self.filament_filter.blockSignals(True)
        current = self.filament_filter.currentData()
        self.filament_filter.clear()
        self.filament_filter.addItem("All", "")
        self.filament_filter.addItem("(unset)", "__unset__")
        if part_dicts:
            used: dict[str, str] = {}
            for p in part_dicts:
                fid = p.get("filament_color_id")
                if fid and fid not in used:
                    used[fid] = p.get("filament_display") or fid
            for fid in sorted(used.keys(), key=lambda k: used[k].lower()):
                self.filament_filter.addItem(used[fid], fid)
        if current is not None:
            idx = self.filament_filter.findData(current)
            if idx >= 0:
                self.filament_filter.setCurrentIndex(idx)
        self.filament_filter.blockSignals(False)

    def _load_part_dicts_for_summary(self) -> list[dict]:
        with db_session() as session:
            parts = get_profile_parts(session, self._current_profile_id)
            colors_by_id = self._catalog.by_id()
            units_by_id = print_units_by_part_id(session, self._current_profile_id)
            return [
                part_to_display_dict(
                    p,
                    session,
                    colors_by_id=colors_by_id,
                    print_units_by_id=units_by_id,
                )
                for p in parts
            ]

    def _update_verify_summary(self, part_dicts: list[dict] | None = None) -> None:
        if not self._is_kit_review or self._current_profile_id is None:
            self._verify_summary.setText("")
            return
        if part_dicts is None:
            part_dicts = self._load_part_dicts_for_summary()
        included = [p for p in part_dicts if p.get("included")]
        chosen = len(included)
        unset_filament = sum(1 for row in included if not row.get("filament_color_id"))
        conflicts = sum(1 for row in included if row.get("status") == "conflict")
        summary = f"{chosen} part(s) chosen for printing"
        extras: list[str] = []
        if unset_filament:
            extras.append(f"{unset_filament} unset filament")
        if conflicts:
            extras.append(f"{conflicts} conflict{'s' if conflicts != 1 else ''}")
        if extras:
            summary += " · " + " · ".join(extras)
        self._verify_summary.setText(summary)

    def _selected_part_id(self) -> int | None:
        return self._last_selected_part_id

    def _on_visible_parts_changed(self) -> None:
        self._visible_part_ids = self.parts_panel.visible_part_ids()

    def _on_parts_inclusion_changed(self, included_ids: set[int]) -> None:
        if self._current_profile_id is None:
            return
        with db_session() as session:
            all_parts = get_profile_parts(session, self._current_profile_id)
            for part in all_parts:
                included = part.id in included_ids
                part.included = included
                if included:
                    if part.status == "excluded":
                        part.status = "base"
                else:
                    part.status = "excluded"
        self._load_parts()
        self.profile_changed.emit()

    def _on_all_printed_toggled(self, part_id: int, all_printed: bool) -> None:
        with db_session() as session:
            mark_part_printed(session, part_id, all=all_printed)
        self._reload_print_progress_ui()

    def _on_part_quantity_changed(self, part_id: int, value: int) -> None:
        with db_session() as session:
            part = session.get(Part, part_id)
            if part:
                part.quantity_override = value
                part.quantity_effective = value
        if self._selected_part_id() == part_id:
            self.qty_spin.blockSignals(True)
            self.qty_spin.setValue(value)
            self.qty_spin.blockSignals(False)
        self._reload_print_progress_ui()

    def _on_qty_spin_changed(self, value: int) -> None:
        pid = self._selected_part_id()
        if pid is None:
            return
        self._on_part_quantity_changed(pid, value)

    def _reload_print_progress_ui(self) -> None:
        if self._current_profile_id is None:
            return
        with db_session() as session:
            from print_partner.core.print_progress import print_units_by_part_id

            parts = get_profile_parts(session, self._current_profile_id)
            colors_by_id = self._catalog.by_id()
            units_by_id = print_units_by_part_id(session, self._current_profile_id)
            part_dicts = [
                part_to_display_dict(
                    p,
                    session,
                    colors_by_id=colors_by_id,
                    print_units_by_id=units_by_id,
                )
                for p in parts
            ]
            stl_index = build_profile_stl_index(session, self._current_profile_id)
            enrich_thumbnail_paths(part_dicts, parts, stl_index)

        if self._is_checkoff:
            self.parts_panel.refresh_checkoff_rows(part_dicts)
            return
        if self._is_kit_review:
            visible = self._visible_part_ids
            filtered_dicts = [d for d in part_dicts if d["id"] in visible]
            self.parts_panel.refresh_progress_rows(part_dicts, filtered_dicts)
            self._update_verify_summary(part_dicts)
            if self._top_mode == "checkoff":
                self._update_checkoff_progress(part_dicts)
            return

        visible = self._visible_part_ids
        filtered_dicts = [d for d in part_dicts if d["id"] in visible]
        self.parts_panel.load_parts(part_dicts, filtered_dicts)
        self._update_verify_summary(part_dicts)

    def _on_part_selected_by_id(self, part_id: int) -> None:
        self._last_selected_part_id = part_id
        self._on_part_selected()

    def _resolve_repo_path(self, repo_name: str) -> Path | None:
        if self._current_profile_id is None:
            return None
        with db_session() as session:
            for layer in get_profile_layers(session, self._current_profile_id):
                if not layer.project_id:
                    continue
                proj = session.get(Project, layer.project_id)
                if not proj or not proj.local_path:
                    continue
                label = f"{layer.layer_type}:{proj.name}"
                if repo_name_from_source_layer(label) == repo_name or proj.name == repo_name:
                    return Path(proj.local_path)
        return None

    def _on_tree_path_selected(self, repo_name: str, folder_path: str) -> None:
        if not self._is_kit_compose:
            return
        repo_path = self._resolve_repo_path(repo_name)
        if repo_path and repo_path.is_dir():
            rel = folder_path if folder_path and folder_path not in (".", "") else ""
            self.docs_panel.load_doc(repo_path, rel or None)
        else:
            self.docs_panel.load_doc(None, None)

    def _on_part_selected(self) -> None:
        pid = self._selected_part_id()
        if pid is None:
            return
        stl_path = None
        repo_path = None
        role = "primary"
        mesh_hex = None
        with db_session() as session:
            part = session.get(Part, pid)
            if not part:
                return
            role = part.role
            mesh_hex = resolve_part_filament_hex(part)
            if self._is_kit_compose:
                self.role_edit.blockSignals(True)
                self.role_edit.setCurrentText(part.role)
                self.role_edit.blockSignals(False)
                self.filament_picker.set_value(part.filament_color_id, part.filament_custom_hex)
                mesh_hex = self._preview_mesh_hex()
                self.qty_spin.setValue(part.quantity_effective)
                self.notes_edit.setPlainText(part.notes or "")
            stl_resolved = resolve_part_stl_path(session, part)
            if stl_resolved:
                stl_path = stl_resolved
                if self._is_kit_compose:
                    for layer in get_profile_layers(session, part.profile_id):
                        if layer.project_id:
                            proj = session.get(Project, layer.project_id)
                            if proj and proj.local_path:
                                repo_path = Path(proj.local_path)
                                break
        QTimer.singleShot(
            0,
            lambda sp=stl_path, rp=repo_path, r=role, mh=mesh_hex: self._deferred_part_preview(
                sp, rp, r, mh
            ),
        )

    def _refresh_stl_preview(self) -> None:
        pid = self._selected_part_id()
        if pid is None:
            return
        stl_path = None
        role = self.role_edit.currentText() or "primary"
        mesh_hex = self._preview_mesh_hex()
        with db_session() as session:
            part = session.get(Part, pid)
            if part:
                stl_path = resolve_part_stl_path(session, part)
        self.stl_viewer.load_stl(stl_path, role=role, mesh_hex=mesh_hex)

    def _deferred_part_preview(
        self,
        stl_path: Path | None,
        repo_path: Path | None,
        role: str = "primary",
        mesh_hex: str | None = None,
    ) -> None:
        if self._is_kit_compose:
            if repo_path and repo_path.is_dir():
                rel = ""
                if stl_path:
                    try:
                        rel = stl_path.relative_to(repo_path).as_posix()
                    except ValueError:
                        pass
                self.docs_panel.load_doc(repo_path, rel or None)
            else:
                self.docs_panel.load_doc(None, None)
        self.stl_viewer.load_stl(stl_path, role=role, mesh_hex=mesh_hex)

    def _invalidate_part_thumbnails(self, part_id: int) -> None:
        with db_session() as session:
            part = session.get(Part, part_id)
            if not part:
                return
            stl = resolve_part_stl_path(session, part)
            if stl:
                mesh_hex = resolve_part_filament_hex(part)
                invalidate_global_thumbnails(stl, part.role, mesh_hex, all_variants=True)

    def _invalidate_parts_thumbnails(self, part_ids: list[int]) -> None:
        if not part_ids:
            return
        with db_session() as session:
            for part_id in part_ids:
                part = session.get(Part, part_id)
                if not part:
                    continue
                stl = resolve_part_stl_path(session, part)
                if stl:
                    mesh_hex = resolve_part_filament_hex(part)
                    invalidate_global_thumbnails(stl, part.role, mesh_hex, all_variants=True)

    def _picker_filament_assignment(self) -> tuple[str | None, str | None]:
        """Catalog id and optional custom hex from the filament picker."""
        return self.filament_picker.selected_color_id(), self.filament_picker.custom_hex()

    def _save_overrides(self) -> None:
        pid = self._selected_part_id()
        if pid is None:
            return
        with db_session() as session:
            part = session.get(Part, pid)
            if part:
                part.role = self.role_edit.currentText()
                part.filament_color_id = self.filament_picker.selected_color_id()
                part.filament_custom_hex = self.filament_picker.custom_hex()
                part.quantity_override = self.qty_spin.value()
                part.quantity_effective = self.qty_spin.value()
                part.notes = self.notes_edit.toPlainText()
        self._invalidate_part_thumbnails(pid)
        self._load_parts()
        self._refresh_stl_preview()
        self._schedule_thumbnail_cache()

    def _bulk_assign_filament(self, role: str) -> None:
        if self._current_profile_id is None:
            return
        color_id, custom_hex = self._picker_filament_assignment()
        if not color_id and not custom_hex:
            QMessageBox.information(
                self,
                "Assign filament",
                "Select a catalog color or pick a custom color with the swatch / hex field.",
            )
            return
        use_visible = bool(self._visible_part_ids) and (
            self._status_filter
            or self.role_combo.currentText()
            or self.filament_filter.currentData() not in ("", None)
            or self.included_only.currentIndex() != 0
        )
        updated_ids: list[int] = []
        if use_visible:
            with db_session() as session:
                updated = 0
                for part in get_profile_parts(session, self._current_profile_id):
                    if part.id not in self._visible_part_ids or part.role != role:
                        continue
                    part.filament_color_id = color_id
                    part.filament_custom_hex = custom_hex
                    updated_ids.append(part.id)
                    updated += 1
        else:
            with db_session() as session:
                updated = bulk_set_filament_color(
                    session,
                    self._current_profile_id,
                    role,
                    color_id,
                    included_only=False,
                    custom_hex=custom_hex,
                )
                updated_ids = [
                    p.id
                    for p in get_profile_parts(session, self._current_profile_id)
                    if p.role == role
                ]
        self._invalidate_parts_thumbnails(updated_ids)
        self._load_parts()
        if self._selected_part_id() is not None:
            self._refresh_stl_preview()
        self._schedule_thumbnail_cache()
        from print_partner.ui.toast import show_toast

        show_toast(self, f"Set filament on {updated} {role} part(s).")

    def _filters_setting_key(self) -> str | None:
        if self._current_profile_id is None:
            return None
        return f"profile_filters:{self._current_profile_id}"

    def _save_filter_state(self) -> None:
        key = self._filters_setting_key()
        if not key:
            return
        filament = self.filament_filter.currentData()
        state = {
            "status": self.status_combo.currentText(),
            "role": self.role_combo.currentText(),
            "filament": filament if filament is not None else "",
            "included_idx": self.included_only.currentIndex(),
        }
        set_setting_value(key, json.dumps(state))

    def _restore_filter_state(self) -> None:
        key = self._filters_setting_key()
        if not key:
            return
        raw = get_setting_value(key)
        if not raw:
            return
        try:
            state = json.loads(raw)
        except json.JSONDecodeError:
            return
        self.status_combo.blockSignals(True)
        self.role_combo.blockSignals(True)
        self.filament_filter.blockSignals(True)
        self.included_only.blockSignals(True)
        status = state.get("status", "")
        if status:
            idx = self.status_combo.findText(status)
            if idx >= 0:
                self.status_combo.setCurrentIndex(idx)
        role = state.get("role", "")
        if role:
            idx = self.role_combo.findText(role)
            if idx >= 0:
                self.role_combo.setCurrentIndex(idx)
        filament = state.get("filament", "")
        idx = self.filament_filter.findData(filament)
        if idx >= 0:
            self.filament_filter.setCurrentIndex(idx)
        inc = state.get("included_idx")
        if isinstance(inc, int) and 0 <= inc < self.included_only.count():
            self.included_only.setCurrentIndex(inc)
        self.status_combo.blockSignals(False)
        self.role_combo.blockSignals(False)
        self.filament_filter.blockSignals(False)
        self.included_only.blockSignals(False)
        self._status_filter = self.status_combo.currentText()

    def _apply_filters(self) -> None:
        self._status_filter = self.status_combo.currentText()
        self._save_filter_state()
        if self._cached_part_dicts and self._is_kit_compose:
            self._apply_compose_parts_ui(self._cached_part_dicts)
        else:
            self._schedule_load_parts()