"""Profiles tab — layers, merge, parts table."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMenu,
    QMessageBox,
    QProgressDialog,
    QPushButton,
    QSpinBox,
    QSplitter,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from print_partner.core.ambrosia_catalog import (
    AmbrosiaCatalog,
    catalog_status_text,
    invalidate_catalog_cache,
    load_catalog,
)
from print_partner.core.parts_tree import repo_name_from_source_layer

from print_partner.config import settings
from print_partner.core.export_html import export_path_for_profile, open_html_file
from print_partner.core.merge import MergePart
from print_partner.core.part_paths import (
    build_profile_stl_index,
    resolve_part_stl_path,
    thumbnail_jobs_for_profile,
)
from print_partner.core.print_checklist import enrich_thumbnail_paths
from print_partner.core.thumbnails import invalidate_global_thumbnails
from print_partner.core.filament_color_resolve import resolve_part_filament_hex
from print_partner.core.print_progress import (
    mark_part_printed,
    print_units_by_part_id,
)
from print_partner.core.profile_ops import (
    add_addon_project,
    delete_profile,
    duplicate_profile,
    recompute_profile,
    restore_profile_from_template,
    remove_layer,
    rename_profile,
    replace_layer_project,
    set_base_project,
    set_profile_order_number,
)
from print_partner.db.models import BuildProfile, Part, Project
from print_partner.db.session import (
    bulk_set_filament_color,
    db_session,
    get_profile_layers,
    get_profile_parts,
    list_profiles,
    get_setting_value,
    list_projects,
    part_to_display_dict,
    set_setting_value,
)
from print_partner.ui.diff_view import DiffView
from print_partner.ui.docs_panel import DocsPanel
from print_partner.ui.stl_viewer import StlViewer
from print_partner.ui.build_wizard import BuildWizard
from print_partner.ui.filament_picker_widget import FilamentPickerWidget
from print_partner.ui.profile_layers_panel import ProfileLayersPanel
from print_partner.ui.profile_parts_panel import ProfilePartsPanel
from print_partner.ui.catalog_sync_worker import CatalogSyncWorker
from print_partner.ui.export_worker import ExportWorker, HtmlExportResult, StlExportResult
from print_partner.ui.recompute_worker import RecomputeWorker
from print_partner.ui.thumbnail_cache_worker import ThumbnailCacheWorker
from print_partner.core.wizard_finish import load_wizard_state_from_profile


class ProfileComposer(QWidget):
    profile_changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._current_profile_id: int | None = None
        self._last_selected_part_id: int | None = None
        self._status_filter = ""
        self._last_export_path: Path | None = None
        self._catalog: AmbrosiaCatalog = load_catalog()
        self._visible_part_ids: set[int] = set()
        self._thumb_worker: ThumbnailCacheWorker | None = None
        self._recompute_worker: RecomputeWorker | None = None
        self._catalog_worker: CatalogSyncWorker | None = None
        self._export_worker: ExportWorker | None = None
        self._thumb_debounce = QTimer(self)
        self._thumb_debounce.setSingleShot(True)
        self._thumb_debounce.setInterval(500)
        self._thumb_debounce.timeout.connect(self._start_thumbnail_cache)
        self._view_mode: Literal["build", "verify", "checkoff"] = "build"

        root = QVBoxLayout(self)
        top = QHBoxLayout()
        self.profile_combo = QComboBox()
        self.profile_combo.currentIndexChanged.connect(self._on_profile_selected)
        top.addWidget(QLabel("Profile:"))
        top.addWidget(self.profile_combo, 1)
        top.addWidget(QLabel("Order #:"))
        self.order_number_edit = QLineEdit()
        self.order_number_edit.setPlaceholderText("Optional")
        self.order_number_edit.setMaximumWidth(140)
        self.order_number_edit.editingFinished.connect(self._save_order_number)
        top.addWidget(self.order_number_edit)
        self.btn_manage = QPushButton("Manage ▾")
        manage_menu = QMenu(self)
        manage_menu.addAction("Rename…", self._manage_rename)
        manage_menu.addAction("Delete…", self._manage_delete)
        manage_menu.addAction("Duplicate in database…", self._manage_duplicate_db)
        manage_menu.addAction("Edit in wizard…", self._manage_edit_wizard)
        self.btn_manage.setMenu(manage_menu)
        top.addWidget(self.btn_manage)
        self.btn_new_build = QPushButton("New build…")
        self.btn_new_build.clicked.connect(self._new_build_wizard)
        top.addWidget(self.btn_new_build)
        self.btn_duplicate_build = QPushButton("Duplicate build")
        self.btn_duplicate_build.clicked.connect(self._duplicate_build_wizard)
        top.addWidget(self.btn_duplicate_build)
        self._btn_new_profile = QPushButton("New")
        self._btn_new_profile.clicked.connect(self._new_profile)
        top.addWidget(self._btn_new_profile)
        self._btn_export_html = QPushButton("Export HTML")
        self._btn_export_html.clicked.connect(self._export_html)
        top.addWidget(self._btn_export_html)
        self._btn_export_stls = QPushButton("Export STLs…")
        self._btn_export_stls.clicked.connect(self._export_stls)
        top.addWidget(self._btn_export_stls)
        self._btn_export_all = QPushButton("Export all")
        self._btn_export_all.clicked.connect(self._export_all)
        top.addWidget(self._btn_export_all)
        self._btn_open_html = QPushButton("Open HTML")
        self._btn_open_html.clicked.connect(self._open_html)
        top.addWidget(self._btn_open_html)
        self.btn_refresh_colors = QPushButton("Refresh Ambrosia colors")
        self.btn_refresh_colors.clicked.connect(self._refresh_ambrosia_colors)
        top.addWidget(self.btn_refresh_colors)
        root.addLayout(top)

        self.catalog_status = QLabel(catalog_status_text(self._catalog))
        self.catalog_status.setProperty("muted", True)
        root.addWidget(self.catalog_status)

        self.thumb_status = QLabel("Thumbnails: run Recompute to cache in background")
        self.thumb_status.setProperty("muted", True)
        root.addWidget(self.thumb_status)

        self._verify_summary = QLabel("")
        self._verify_summary.setProperty("muted", True)
        self._verify_summary.setWordWrap(True)
        root.addWidget(self._verify_summary)

        self._print_progress_summary = QLabel("")
        self._print_progress_summary.setProperty("muted", True)
        self._print_progress_summary.setWordWrap(True)
        root.addWidget(self._print_progress_summary)

        self.layers_panel = ProfileLayersPanel()
        self.layers_panel.set_base_requested.connect(self._set_base)
        self.layers_panel.add_addon_requested.connect(self._add_addon)
        self.layers_panel.change_project_requested.connect(self._change_layer_project)
        self.layers_panel.remove_addon_requested.connect(self._remove_layer)
        self.layers_panel.recompute_requested.connect(self._recompute)
        root.addWidget(self.layers_panel)

        self._filters_host = QWidget()
        filters = QHBoxLayout(self._filters_host)
        filters.setContentsMargins(0, 0, 0, 0)
        filters.addWidget(QLabel("Status:"))
        self.status_combo = QComboBox()
        self.status_combo.addItems(["", "base", "added", "replaced", "conflict", "excluded"])
        self.status_combo.currentTextChanged.connect(self._apply_filters)
        filters.addWidget(self.status_combo)
        filters.addWidget(QLabel("Role:"))
        self.role_combo = QComboBox()
        self.role_combo.addItems(["", "primary", "accent", "clear", "opaque"])
        self.role_combo.currentTextChanged.connect(self._apply_filters)
        filters.addWidget(self.role_combo)
        self.included_only = QComboBox()
        self.included_only.addItems(["All", "Included only", "Excluded only"])
        self.included_only.currentIndexChanged.connect(self._apply_filters)
        filters.addWidget(self.included_only)
        filters.addWidget(QLabel("Filament:"))
        self.filament_filter = QComboBox()
        self.filament_filter.currentIndexChanged.connect(self._apply_filters)
        filters.addWidget(self.filament_filter)
        root.addWidget(self._filters_host)

        self._splitter = QSplitter(Qt.Horizontal)
        splitter = self._splitter
        left = QWidget()
        left_layout = QVBoxLayout(left)
        self.parts_panel = ProfilePartsPanel()
        self.parts_panel.set_callbacks(
            on_inclusion_changed=self._on_parts_inclusion_changed,
            on_quantity_changed=self._on_part_quantity_changed,
            on_all_printed_toggled=self._on_all_printed_toggled,
        )
        self.parts_panel.part_selected.connect(self._on_part_selected_by_id)
        self.parts_panel.tree_path_selected.connect(self._on_tree_path_selected)
        self.parts_panel.visible_part_ids_changed.connect(self._on_visible_parts_changed)
        left_layout.addWidget(self.parts_panel, 1)

        self._editor_host = QWidget()
        editor_layout = QVBoxLayout(self._editor_host)
        editor_layout.setContentsMargins(0, 0, 0, 0)
        edit_row = QHBoxLayout()
        self.role_edit = QComboBox()
        self.role_edit.addItems(["primary", "accent", "clear", "opaque"])
        self.filament_picker = FilamentPickerWidget(self._catalog)
        self.filament_picker.setMinimumWidth(320)
        self.btn_assign_filament = QPushButton("Assign color to role…")
        self.btn_assign_filament.setMenu(self._build_assign_filament_menu())
        self.qty_spin = QSpinBox()
        self.qty_spin.setRange(1, 999)
        self.qty_spin.valueChanged.connect(self._on_qty_spin_changed)
        self.notes_edit = QTextEdit()
        self.notes_edit.setMaximumHeight(60)
        self.btn_save_part = QPushButton("Save overrides")
        self.btn_save_part.clicked.connect(self._save_overrides)
        self.filament_picker.color_changed.connect(self._on_preview_color_changed)
        self.role_edit.currentIndexChanged.connect(self._on_preview_color_changed)
        self.btn_preview = QPushButton("Preview STL")
        self.btn_preview.clicked.connect(self._on_part_selected)
        edit_row.addWidget(self.btn_preview)
        edit_row.addWidget(QLabel("Role"))
        edit_row.addWidget(self.role_edit)
        edit_row.addWidget(QLabel("Filament"))
        edit_row.addWidget(self.filament_picker, 1)
        edit_row.addWidget(self.btn_assign_filament)
        edit_row.addWidget(QLabel("Qty"))
        edit_row.addWidget(self.qty_spin)
        edit_row.addWidget(self.btn_save_part)
        editor_layout.addLayout(edit_row)
        editor_layout.addWidget(QLabel("Notes"))
        editor_layout.addWidget(self.notes_edit)
        left_layout.addWidget(self._editor_host)
        splitter.addWidget(left)

        right = QWidget()
        right_layout = QVBoxLayout(right)
        self.diff_view = DiffView()
        self.diff_view.filter_changed.connect(self._on_diff_filter)
        right_layout.addWidget(self.diff_view)
        self.stl_viewer = StlViewer()
        right_layout.addWidget(self.stl_viewer, 2)
        self.docs_panel = DocsPanel()
        right_layout.addWidget(self.docs_panel, 1)
        self._splitter_right = right
        splitter.addWidget(right)
        splitter.setSizes([500, 400])
        root.addWidget(splitter, 1)
        self.refresh_profiles()
        self.set_view_mode("build")

    def set_view_mode(self, mode: Literal["build", "verify", "checkoff"]) -> None:
        self._view_mode = mode
        is_build = mode == "build"
        is_verify = mode == "verify"
        is_checkoff = mode == "checkoff"

        self.layers_panel.setVisible(is_build)
        self.catalog_status.setVisible(is_build)
        self.thumb_status.setVisible(is_build or is_checkoff)
        self.btn_new_build.setVisible(is_build)
        self.btn_duplicate_build.setVisible(is_build)
        self._btn_new_profile.setVisible(is_build)
        self.btn_refresh_colors.setVisible(is_build)
        self._filters_host.setVisible(is_build)
        self._splitter.setVisible(is_build or is_verify or is_checkoff)
        self._splitter_right.setVisible(is_build or is_checkoff)
        self._editor_host.setVisible(is_build)
        self._verify_summary.setVisible(is_verify)
        self._print_progress_summary.setVisible(is_checkoff)
        self.diff_view.setVisible(False)
        self.stl_viewer.setVisible(is_build or is_checkoff)
        self.docs_panel.setVisible(is_build)
        self._btn_export_html.setVisible(is_checkoff)
        self._btn_export_stls.setVisible(is_checkoff)
        self._btn_export_all.setVisible(is_checkoff)
        self._btn_open_html.setVisible(is_checkoff)

        if is_checkoff:
            self.parts_panel.set_panel_mode("checkoff")
            self._update_print_progress_summary()
            self._splitter.setSizes([700, 380])
        elif is_verify:
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
            QMessageBox.information(
                self,
                "Ambrosia colors",
                f"Loaded {len(self._catalog.colors)} colors from West3D.",
            )

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

    @staticmethod
    def _profile_label(name: str, order_number: str | None) -> str:
        if order_number:
            return f"{name} — Order {order_number}"
        return name

    def refresh_profiles(self, select_profile_id: int | None = None) -> None:
        self._catalog = load_catalog()
        if select_profile_id is None and self._current_profile_id is None:
            last = get_setting_value("last_profile_id")
            if last:
                try:
                    candidate = int(last)
                    select_profile_id = candidate
                except ValueError:
                    pass
        prev_id = select_profile_id if select_profile_id is not None else self._current_profile_id
        self.profile_combo.blockSignals(True)
        self.profile_combo.clear()
        profile_ids: list[int] = []
        with db_session() as session:
            for p in list_profiles(session):
                self.profile_combo.addItem(
                    self._profile_label(p.name, p.order_number), p.id
                )
                profile_ids.append(p.id)
        if prev_id is not None and prev_id not in profile_ids:
            prev_id = None
        restore_index = -1
        if prev_id is not None:
            for i in range(self.profile_combo.count()):
                if self.profile_combo.itemData(i) == prev_id:
                    restore_index = i
                    break
        if restore_index < 0 and self.profile_combo.count():
            restore_index = 0
        if restore_index >= 0:
            self.profile_combo.setCurrentIndex(restore_index)
        self.profile_combo.blockSignals(False)
        if restore_index >= 0:
            self._on_profile_selected(restore_index)
        else:
            self._current_profile_id = None
            self._clear_parts_table()

    def _on_profile_selected(self, index: int = -1) -> None:
        idx = index if index >= 0 else self.profile_combo.currentIndex()
        if idx < 0:
            self._current_profile_id = None
            self._clear_parts_table()
            return
        new_id = self.profile_combo.itemData(idx)
        profile_changed = new_id != self._current_profile_id
        self._current_profile_id = new_id
        if self._current_profile_id is not None:
            set_setting_value("last_profile_id", str(self._current_profile_id))
        if profile_changed:
            self._restore_filter_state()
        self._load_parts()

    def _clear_parts_table(self) -> None:
        self.parts_panel.load_parts([], [])
        self.diff_view.update_counts({})
        self.layers_panel.load_layers([])
        self.order_number_edit.clear()

    def _new_build_wizard(self) -> None:
        wiz = BuildWizard(parent=self)
        wiz.build_finished.connect(self._on_build_wizard_finished)
        wiz.exec()

    def _duplicate_build_wizard(self) -> None:
        if self._current_profile_id is None:
            QMessageBox.information(self, "Duplicate build", "Select a profile to duplicate.")
            return
        with db_session() as session:
            state = load_wizard_state_from_profile(session, self._current_profile_id)
        state.mode = "new"
        state.profile_id = None
        state.profile_name = f"{state.profile_name} (copy)"
        wiz = BuildWizard(state, parent=self)
        wiz.build_finished.connect(self._on_build_wizard_finished)
        wiz.exec()

    def _on_build_wizard_finished(self, profile_id: int) -> None:
        self.refresh_profiles(select_profile_id=profile_id)
        self.profile_changed.emit()
        self._start_thumbnail_cache()

    def _new_profile(self) -> None:
        name, ok = QInputDialog.getText(self, "New profile", "Profile name:")
        if not ok or not name.strip():
            return
        with db_session() as session:
            from sqlalchemy import select

            if session.scalars(select(BuildProfile).where(BuildProfile.name == name.strip())).first():
                QMessageBox.warning(self, "Duplicate", "Profile already exists.")
                return
            bp = BuildProfile(name=name.strip())
            session.add(bp)
            session.flush()
            new_id = bp.id
        self.refresh_profiles(select_profile_id=new_id)

    def _set_base(self) -> None:
        if self._current_profile_id is None:
            return
        projects = self._pick_project("Select base project")
        if not projects:
            return
        with db_session() as session:
            set_base_project(session, self._current_profile_id, projects[0])
        self._recompute()

    def _add_addon(self) -> None:
        if self._current_profile_id is None:
            return
        projects = self._pick_project("Select addon project")
        if not projects:
            return
        with db_session() as session:
            add_addon_project(session, self._current_profile_id, projects[0])
        self._recompute()

    def _change_layer_project(self, layer_id: int) -> None:
        projects = self._pick_project("Select project for layer")
        if not projects:
            return
        with db_session() as session:
            replace_layer_project(session, layer_id, projects[0])
        self._recompute()

    def _remove_layer(self, layer_id: int) -> None:
        if self._current_profile_id is None:
            return
        try:
            with db_session() as session:
                remove_layer(session, layer_id)
                recompute_profile(session, self._current_profile_id)
        except ValueError as exc:
            QMessageBox.warning(self, "Remove layer", str(exc))
            return
        self._load_parts()

    def _pick_project(self, title: str) -> list[int]:
        with db_session() as session:
            projs = list_projects(session)
            if not projs:
                QMessageBox.information(self, title, "Add and sync projects first.")
                return []
            # Read attributes inside session — ORM objects detach after commit.
            choices = [(p.id, p.name) for p in projs]
        dlg = QDialog(self)
        dlg.setWindowTitle(title)
        layout = QVBoxLayout(dlg)
        layout.addWidget(QLabel("Select a project:"))
        list_widget = QListWidget()
        for pid, proj_name in choices:
            item = QListWidgetItem(proj_name)
            item.setData(Qt.UserRole, pid)
            list_widget.addItem(item)
        if list_widget.count():
            list_widget.setCurrentRow(0)
        list_widget.setMinimumSize(320, 200)
        layout.addWidget(list_widget)
        buttons = QDialogButtonBox(
            QDialogButtonBox.Ok | QDialogButtonBox.Cancel
        )
        buttons.accepted.connect(dlg.accept)
        buttons.rejected.connect(dlg.reject)
        layout.addWidget(buttons)
        if dlg.exec() != QDialog.Accepted:
            return []
        item = list_widget.currentItem()
        if item is None:
            return []
        pid = item.data(Qt.UserRole)
        if pid is None:
            return []
        return [int(pid)]

    def _recompute(self) -> None:
        if self._current_profile_id is None:
            return
        if self._recompute_worker and self._recompute_worker.isRunning():
            return
        progress = QProgressDialog("Recomputing profile…", "Cancel", 0, 0, self)
        progress.setWindowModality(Qt.WindowModal)
        progress.setMinimumDuration(0)
        progress.setLabelText("Scanning layers and merging parts…")
        profile_id = self._current_profile_id
        self._recompute_worker = RecomputeWorker(profile_id, parent=self)

        def on_progress(message: str) -> None:
            progress.setLabelText(message)
            if progress.wasCanceled() and self._recompute_worker:
                self._recompute_worker.cancel()

        def on_finished(result: dict) -> None:
            progress.close()
            self._recompute_worker = None
            if result.get("reason") == "cancelled":
                return
            if not result.get("merged"):
                reason = result.get("reason", "no_layers")
                if reason == "no_stls":
                    text = result.get("message") or (
                        "No STL files matched import rules.\n\n"
                        "Use Projects → Import files… for each repo."
                    )
                elif reason == "would_wipe":
                    text = result.get("message") or "Recompute would remove all parts."
                else:
                    text = (
                        "No layers to scan.\n\n"
                        "1. On Source tab: add repos and Sync selected.\n"
                        "2. Add base project via layers panel.\n"
                        "3. Then Recompute."
                    )
                QMessageBox.warning(self, "Recompute", text)
                return
            self._load_parts()
            self.profile_changed.emit()
            self._start_thumbnail_cache()

        def on_error(message: str) -> None:
            progress.close()
            self._recompute_worker = None
            QMessageBox.critical(self, "Recompute failed", message)

        self._recompute_worker.progress.connect(on_progress)
        self._recompute_worker.finished_ok.connect(on_finished)
        self._recompute_worker.error.connect(on_error)
        self._recompute_worker.start()

    def _stop_thumbnail_worker(self) -> None:
        if self._thumb_worker and self._thumb_worker.isRunning():
            self._thumb_worker.cancel()
            self._thumb_worker.wait(8000)
        self._thumb_worker = None

    def _stop_background_workers(self) -> None:
        self._thumb_debounce.stop()
        self._stop_thumbnail_worker()
        for worker in (self._recompute_worker, self._catalog_worker, self._export_worker):
            if worker and worker.isRunning():
                if hasattr(worker, "cancel"):
                    worker.cancel()
                worker.wait(8000)

    def shutdown(self) -> None:
        """Stop background work before application exit."""
        self._stop_background_workers()
        self.stl_viewer.shutdown()

    def _schedule_thumbnail_cache(self) -> None:
        self._thumb_debounce.start()

    def _start_thumbnail_cache(self) -> None:
        if self._current_profile_id is None:
            return
        self._stop_thumbnail_worker()
        with db_session() as session:
            jobs = thumbnail_jobs_for_profile(session, self._current_profile_id)
        if not jobs:
            self.thumb_status.setText("Thumbnails: no STL files found for included parts")
            return
        self.thumb_status.setText(f"Thumbnails: caching 0/{len(jobs)}…")
        self._thumb_worker = ThumbnailCacheWorker(jobs, parent=self)
        self._thumb_worker.progress.connect(self._on_thumb_cache_progress)
        self._thumb_worker.finished_counts.connect(self._on_thumb_cache_finished)
        self._thumb_worker.start()

    def _on_thumb_cache_progress(self, done: int, total: int, filename: str) -> None:
        self.thumb_status.setText(f"Thumbnails: {done}/{total} — {filename}")

    def _on_thumb_cache_finished(self, generated: int, skipped: int, failed: int) -> None:
        self._thumb_worker = None
        if failed:
            self.thumb_status.setText(
                f"Thumbnails: {generated} new, {skipped} cached, {failed} failed (export will retry)"
            )
        else:
            self.thumb_status.setText(
                f"Thumbnails ready ({generated} generated, {skipped} already cached)"
            )
        if self._view_mode == "checkoff" and self._current_profile_id is not None:
            self._load_parts()

    def _load_parts(self) -> None:
        if self._current_profile_id is None:
            return
        with db_session() as session:
            from print_partner.core.print_progress import print_units_by_part_id

            profile = session.get(BuildProfile, self._current_profile_id)
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
            layers = get_profile_layers(session, self._current_profile_id)
            layer_dicts: list[dict] = []
            for layer in layers:
                label = layer.layer_type
                if layer.project_id:
                    proj = session.get(Project, layer.project_id)
                    if proj:
                        sync_hint = "synced" if proj.local_path else "not synced"
                        label = f"{layer.layer_type}: {proj.name} ({sync_hint})"
                    else:
                        label = f"{layer.layer_type}: project #{layer.project_id}"
                layer_dicts.append(
                    {
                        "id": layer.id,
                        "layer_order": layer.layer_order,
                        "layer_type": layer.layer_type,
                        "label": label,
                    }
                )
            profile_name = profile.name if profile else ""
            order_number = profile.order_number if profile else None
        self.order_number_edit.blockSignals(True)
        self.order_number_edit.setText(order_number or "")
        self.order_number_edit.blockSignals(False)
        self.layers_panel.load_layers(
            layer_dicts,
            order_number=order_number,
            profile_name=profile_name,
        )
        self._rebuild_filament_filter(part_dicts)
        counts: dict[str, int] = {}
        filtered_dicts: list[dict] = []
        filament_f = self.filament_filter.currentData()
        for row in part_dicts:
            counts[row["status"]] = counts.get(row["status"], 0) + 1
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

        filtered_ids = {d["id"] for d in filtered_dicts}
        self._visible_part_ids = filtered_ids
        self.diff_view.update_counts(counts)
        self.parts_panel.load_parts(part_dicts, filtered_dicts)
        self._update_verify_summary(part_dicts)
        self._update_print_progress_summary(part_dicts)
        if not part_dicts:
            self._try_restore_wiped_profile()

    def _update_print_progress_summary(self, part_dicts: list[dict] | None = None) -> None:
        if self._view_mode != "checkoff" or self._current_profile_id is None:
            self._print_progress_summary.setText("")
            return
        if part_dicts is None:
            part_dicts = self._load_part_dicts_for_summary()
        from print_partner.core.print_checklist import progress_summary

        self._print_progress_summary.setText(progress_summary(part_dicts))

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
        if self._view_mode != "verify" or self._current_profile_id is None:
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

    def _try_restore_wiped_profile(self) -> None:
        """If this profile was emptied but a '(copy)' sibling still has data, offer restore."""
        if self._current_profile_id is None:
            return
        with db_session() as session:
            profile = session.get(BuildProfile, self._current_profile_id)
            if not profile:
                return
            if get_profile_parts(session, self._current_profile_id):
                return
            from sqlalchemy import select

            candidates = list(
                session.scalars(
                    select(BuildProfile).where(
                        BuildProfile.id != profile.id,
                        BuildProfile.name.contains("(copy)"),
                    )
                ).all()
            )
            source = None
            best_count = 0
            for cand in candidates:
                n = len(get_profile_parts(session, cand.id))
                if n > best_count:
                    best_count = n
                    source = cand
            if not source or best_count == 0:
                return
            reply = QMessageBox.question(
                self,
                "Restore profile?",
                f"“{profile.name}” has no parts, but “{source.name}” still has "
                f"{best_count} parts with your settings.\n\n"
                "Restore your work from the copy into this profile?",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.Yes,
            )
            if reply != QMessageBox.Yes:
                return
            try:
                restored = restore_profile_from_template(
                    session, profile.id, source.id
                )
            except ValueError as exc:
                QMessageBox.warning(self, "Restore failed", str(exc))
                return
        QMessageBox.information(
            self,
            "Profile restored",
            f"Restored {restored} parts into “{profile.name}”.",
        )
        self._load_parts()
        self.profile_changed.emit()

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

        if self._view_mode == "checkoff":
            self.parts_panel.refresh_checkoff_rows(part_dicts)
            self._update_print_progress_summary(part_dicts)
            return
        if self._view_mode == "verify":
            visible = self._visible_part_ids
            filtered_dicts = [d for d in part_dicts if d["id"] in visible]
            self.parts_panel.refresh_progress_rows(part_dicts, filtered_dicts)
            self._update_verify_summary(part_dicts)
            self._update_print_progress_summary(part_dicts)
            return

        visible = self._visible_part_ids
        filtered_dicts = [d for d in part_dicts if d["id"] in visible]
        self.parts_panel.load_parts(part_dicts, filtered_dicts)
        self._update_verify_summary(part_dicts)
        self._update_print_progress_summary(part_dicts)

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
        if self._view_mode != "build":
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
            if self._view_mode == "build":
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
                if self._view_mode == "build":
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
        if self._view_mode == "build":
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

    def _save_order_number(self) -> None:
        if self._current_profile_id is None:
            return
        text = self.order_number_edit.text().strip() or None
        with db_session() as session:
            set_profile_order_number(session, self._current_profile_id, text)
        self.refresh_profiles(select_profile_id=self._current_profile_id)

    def _manage_rename(self) -> None:
        if self._current_profile_id is None:
            return
        with db_session() as session:
            profile = session.get(BuildProfile, self._current_profile_id)
            if not profile:
                return
            current = profile.name
        name, ok = QInputDialog.getText(self, "Rename profile", "Profile name:", text=current)
        if not ok or not name.strip():
            return
        try:
            with db_session() as session:
                rename_profile(session, self._current_profile_id, name.strip())
        except ValueError as exc:
            QMessageBox.warning(self, "Rename", str(exc))
            return
        self.refresh_profiles(select_profile_id=self._current_profile_id)

    def _manage_delete(self) -> None:
        if self._current_profile_id is None:
            return
        name = self.profile_combo.currentText()
        reply = QMessageBox.question(
            self,
            "Delete profile",
            f"Delete profile “{name}” and all its parts?",
            QMessageBox.Yes | QMessageBox.No,
        )
        if reply != QMessageBox.Yes:
            return
        deleted_id = self._current_profile_id
        with db_session() as session:
            delete_profile(session, deleted_id)
        self.refresh_profiles()

    def _manage_duplicate_db(self) -> None:
        if self._current_profile_id is None:
            return
        with db_session() as session:
            profile = session.get(BuildProfile, self._current_profile_id)
            default = f"{profile.name} (copy)" if profile else "Copy"
        name, ok = QInputDialog.getText(self, "Duplicate profile", "New profile name:", text=default)
        if not ok or not name.strip():
            return
        try:
            with db_session() as session:
                new_id = duplicate_profile(session, self._current_profile_id, name.strip())
        except ValueError as exc:
            QMessageBox.warning(self, "Duplicate", str(exc))
            return
        self.refresh_profiles(select_profile_id=new_id)

    def _manage_edit_wizard(self) -> None:
        if self._current_profile_id is None:
            return
        with db_session() as session:
            state = load_wizard_state_from_profile(session, self._current_profile_id)
        state.mode = "load"
        wiz = BuildWizard(state, parent=self)
        wiz.build_finished.connect(self._on_build_wizard_finished)
        wiz.exec()

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
        QMessageBox.information(
            self,
            "Assign filament",
            f"Set filament on {updated} {role} part(s).",
        )

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
        self._load_parts()

    def _on_diff_filter(self, status: str) -> None:
        self.status_combo.setCurrentText(status)
        self._apply_filters()

    def _merge_parts_for_export(self) -> tuple[str, str | None, list[MergePart], dict[str, list[bool]]]:
        with db_session() as session:
            profile = session.get(BuildProfile, self._current_profile_id)
            name = profile.name if profile else self.profile_combo.currentText()
            order_number = profile.order_number if profile else None
            rows = get_profile_parts(session, self._current_profile_id)
            colors_by_id = load_catalog().by_id()
            units_by_id = print_units_by_part_id(session, self._current_profile_id)
            merge_parts: list[MergePart] = []
            completed_by_key: dict[str, list[bool]] = {}

            for r in rows:
                color = colors_by_id.get(r.filament_color_id or "")
                resolved_hex = resolve_part_filament_hex(r)
                mp = MergePart(
                    match_key=r.match_key,
                    relative_path=r.relative_path,
                    filename=r.filename,
                    source_layer=r.source_layer,
                    status=r.status,
                    role=r.role,
                    quantity_auto=r.quantity_auto,
                    quantity_override=r.quantity_override,
                    part_slug=r.filename,
                    included=r.included,
                    notes=r.notes or "",
                    filament_color_id=r.filament_color_id,
                    filament_display=color.combo_label if color else "",
                    filament_hex=resolved_hex,
                    filament_swatch_url="",
                )
                stl = resolve_part_stl_path(session, r)
                if stl:
                    mp.absolute_path = stl
                merge_parts.append(mp)
                completed_by_key[r.match_key] = units_by_id.get(
                    r.id, [False] * max(1, r.quantity_effective)
                )
        return name, order_number, merge_parts, completed_by_key

    def _export_html(self) -> None:
        if self._current_profile_id is None:
            return
        if self._export_worker and self._export_worker.isRunning():
            return
        name, order_number, merge_parts, completed_by_key = self._merge_parts_for_export()
        included = [p for p in merge_parts if p.included]
        progress = QProgressDialog("Preparing export…", "Cancel", 0, max(1, len(included)), self)
        progress.setWindowModality(Qt.WindowModal)
        progress.setMinimumDuration(0)
        progress.setValue(0)
        profile_id = self._current_profile_id
        self._export_worker = ExportWorker(
            kind="html",
            profile_name=name,
            order_number=order_number,
            merge_parts=merge_parts,
            completed_by_key=completed_by_key,
            exports_dir=settings.exports_dir,
            profile_id=profile_id,
            parent=self,
        )

        def on_progress(current: int, total: int, filename: str) -> None:
            progress.setMaximum(max(1, total))
            progress.setLabelText(f"Generating thumbnails ({current}/{total}):\n{filename}")
            progress.setValue(current)
            if progress.wasCanceled() and self._export_worker:
                self._export_worker.cancel()

        def on_done(result: HtmlExportResult) -> None:
            progress.close()
            self._export_worker = None
            if result.cancelled:
                QMessageBox.information(self, "Export", "Export cancelled.")
                return
            self._last_export_path = result.path
            reply = QMessageBox.question(
                self,
                "Export",
                f"Saved to:\n{result.path}\n\n"
                f"{result.part_count} parts, {result.thumb_count} thumbnails "
                f"(stl-thumb or built-in PyVista).\n\n"
                f"Open in your browser now?",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.Yes,
            )
            if reply == QMessageBox.Yes:
                self._open_html_path(result.path)

        def on_error(message: str) -> None:
            progress.close()
            self._export_worker = None
            QMessageBox.critical(self, "Export failed", message)

        self._export_worker.progress.connect(on_progress)
        self._export_worker.html_done.connect(on_done)
        self._export_worker.error.connect(on_error)
        self._export_worker.start()

    def _export_stls(self) -> None:
        if self._current_profile_id is None:
            return
        if self._export_worker and self._export_worker.isRunning():
            return
        name, order_number, merge_parts, completed_by_key = self._merge_parts_for_export()
        included = [p for p in merge_parts if p.included]
        total = sum(max(1, p.quantity_effective) for p in included)
        progress = QProgressDialog("Exporting STLs…", "Cancel", 0, max(1, total), self)
        progress.setWindowModality(Qt.WindowModal)
        progress.setMinimumDuration(0)
        self._export_worker = ExportWorker(
            kind="stl",
            profile_name=name,
            order_number=order_number,
            merge_parts=merge_parts,
            completed_by_key=completed_by_key,
            exports_dir=settings.exports_dir,
            parent=self,
        )

        def on_progress(done: int, tot: int, filename: str) -> None:
            progress.setMaximum(max(1, tot))
            progress.setLabelText(f"Exporting ({done}/{tot}):\n{filename}")
            progress.setValue(done)
            if progress.wasCanceled() and self._export_worker:
                self._export_worker.cancel()

        def on_done(result: StlExportResult) -> None:
            progress.close()
            self._export_worker = None
            if result.cancelled:
                QMessageBox.information(self, "Export", "Export cancelled.")
                return
            summary = "\n".join(
                f"  {role}: {count} zip(s)" for role, count in result.zip_counts.items()
            )
            msg = f"Saved to:\n{result.root}\n\n{summary or 'No zips created.'}"
            if result.warnings:
                msg += f"\n\n{len(result.warnings)} warning(s), e.g.:\n" + "\n".join(
                    result.warnings[:5]
                )
            if not result.zip_counts and not included:
                msg += "\n\nNo included parts to export."
            elif not result.zip_counts and included:
                msg += "\n\nNo STL files found on disk. Sync projects on the Source tab first."
            QMessageBox.information(self, "Export STLs", msg)

        def on_error(message: str) -> None:
            progress.close()
            self._export_worker = None
            QMessageBox.critical(self, "Export failed", message)

        self._export_worker.progress.connect(on_progress)
        self._export_worker.stl_done.connect(on_done)
        self._export_worker.error.connect(on_error)
        self._export_worker.start()

    def _export_all(self) -> None:
        self._export_html()
        if self._current_profile_id is not None:
            self._export_stls()

    def _export_path_for_current_profile(self) -> Path | None:
        if self._current_profile_id is None:
            return None
        name = self.profile_combo.currentText().strip()
        if not name:
            return None
        return export_path_for_profile(name, settings.exports_dir)

    def _open_html_path(self, path: Path) -> None:
        if open_html_file(path):
            return
        QMessageBox.warning(
            self,
            "Open HTML",
            f"Could not open:\n{path}\n\nExport first or choose another file.",
        )

    def _open_html(self) -> None:
        if self._current_profile_id is None:
            QMessageBox.information(self, "Open HTML", "Select a profile first.")
            return

        candidates: list[Path] = []
        if self._last_export_path and self._last_export_path.is_file():
            candidates.append(self._last_export_path)
        profile_path = self._export_path_for_current_profile()
        if profile_path and profile_path not in candidates:
            candidates.insert(0, profile_path)

        for path in candidates:
            if path.is_file():
                self._open_html_path(path)
                return

        start_dir = str(settings.exports_dir)
        if not settings.exports_dir.is_dir():
            start_dir = str(settings.data_dir)

        chosen, _ = QFileDialog.getOpenFileName(
            self,
            "Open HTML export",
            start_dir,
            "HTML files (*.html);;All files (*)",
        )
        if chosen:
            self._open_html_path(Path(chosen))
