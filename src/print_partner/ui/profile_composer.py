"""Profiles tab — layers, merge, parts table."""

from __future__ import annotations

import json
import time
from pathlib import Path

_DEBUG_LOG = Path(__file__).resolve().parents[3] / ".cursor" / "debug-ae4f75.log"


def _dbg(location: str, message: str, data: dict, hypothesis_id: str) -> None:
    # region agent log
    try:
        payload = {
            "sessionId": "ae4f75",
            "timestamp": int(time.time() * 1000),
            "location": location,
            "message": message,
            "data": data,
            "hypothesisId": hypothesis_id,
        }
        with _DEBUG_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except OSError:
        pass
    # endregion

from PySide6.QtCore import Qt, QTimer, Signal
from print_partner.core.filament_color_resolve import effective_filament_hex
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QComboBox,
    QCompleter,
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
    load_catalog,
    resolve_filament_hex,
    sync_ambrosia_catalog,
)

from print_partner.config import settings
from print_partner.core.export_html import (
    export_path_for_profile,
    export_profile_html,
    open_html_file,
)
from print_partner.core.export_stl_zip import export_profile_stl_zips
from print_partner.core.merge import MergePart
from print_partner.core.part_paths import resolve_part_stl_path, thumbnail_jobs_for_profile
from print_partner.core.thumbnails import invalidate_global_thumbnails
from print_partner.core.print_progress import get_print_units, set_unit_completed
from print_partner.core.profile_ops import (
    add_addon_project,
    delete_profile,
    duplicate_profile,
    recompute_profile,
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
from print_partner.ui.profile_layers_panel import ProfileLayersPanel
from print_partner.ui.profile_parts_panel import ProfilePartsPanel
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
        for text, slot in [
            ("New", self._new_profile),
            ("Export HTML", self._export_html),
            ("Export STLs…", self._export_stls),
            ("Export all", self._export_all),
            ("Open HTML", self._open_html),
        ]:
            btn = QPushButton(text)
            btn.clicked.connect(slot)
            top.addWidget(btn)
        self.btn_refresh_colors = QPushButton("Refresh Ambrosia colors")
        self.btn_refresh_colors.clicked.connect(self._refresh_ambrosia_colors)
        top.addWidget(self.btn_refresh_colors)
        root.addLayout(top)

        self.catalog_status = QLabel(catalog_status_text(self._catalog))
        self.catalog_status.setStyleSheet("color: #555; font-size: 0.9em;")
        root.addWidget(self.catalog_status)

        self.thumb_status = QLabel("Thumbnails: run Recompute to cache in background")
        self.thumb_status.setStyleSheet("color: #555; font-size: 0.9em;")
        root.addWidget(self.thumb_status)

        self.layers_panel = ProfileLayersPanel()
        self.layers_panel.set_base_requested.connect(self._set_base)
        self.layers_panel.add_addon_requested.connect(self._add_addon)
        self.layers_panel.change_project_requested.connect(self._change_layer_project)
        self.layers_panel.remove_addon_requested.connect(self._remove_layer)
        self.layers_panel.recompute_requested.connect(self._recompute)
        root.addWidget(self.layers_panel)

        filters = QHBoxLayout()
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
        root.addLayout(filters)

        splitter = QSplitter(Qt.Horizontal)
        left = QWidget()
        left_layout = QVBoxLayout(left)
        self.parts_panel = ProfilePartsPanel()
        self.parts_panel.set_callbacks(
            on_inclusion_changed=self._on_parts_inclusion_changed,
            on_print_toggle=self._on_print_unit_toggle,
        )
        self.parts_panel.part_selected.connect(self._on_part_selected_by_id)
        self.parts_panel.visible_part_ids_changed.connect(self._on_visible_parts_changed)
        left_layout.addWidget(self.parts_panel, 1)

        edit_row = QHBoxLayout()
        self.role_edit = QComboBox()
        self.role_edit.addItems(["primary", "accent", "clear", "opaque"])
        self.filament_edit = QComboBox()
        self.filament_edit.setEditable(True)
        self.filament_edit.setInsertPolicy(QComboBox.NoInsert)
        self.filament_edit.setMinimumWidth(220)
        self._populate_filament_combo()
        self.btn_assign_filament = QPushButton("Assign color to role…")
        self.btn_assign_filament.setMenu(self._build_assign_filament_menu())
        self.qty_spin = QSpinBox()
        self.qty_spin.setRange(1, 999)
        self.notes_edit = QTextEdit()
        self.notes_edit.setMaximumHeight(60)
        self.btn_save_part = QPushButton("Save overrides")
        self.btn_save_part.clicked.connect(self._save_overrides)
        self.filament_edit.currentIndexChanged.connect(self._on_preview_color_changed)
        self.role_edit.currentIndexChanged.connect(self._on_preview_color_changed)
        self.btn_preview = QPushButton("Preview STL")
        self.btn_preview.clicked.connect(self._on_part_selected)
        edit_row.addWidget(self.btn_preview)
        edit_row.addWidget(QLabel("Role"))
        edit_row.addWidget(self.role_edit)
        edit_row.addWidget(QLabel("Filament"))
        edit_row.addWidget(self.filament_edit, 1)
        edit_row.addWidget(self.btn_assign_filament)
        edit_row.addWidget(QLabel("Qty"))
        edit_row.addWidget(self.qty_spin)
        edit_row.addWidget(self.btn_save_part)
        left_layout.addLayout(edit_row)
        left_layout.addWidget(QLabel("Notes"))
        left_layout.addWidget(self.notes_edit)
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
        splitter.addWidget(right)
        splitter.setSizes([500, 400])
        root.addWidget(splitter, 1)
        self.refresh_profiles()

    def _populate_filament_combo(self, select_id: str | None = None) -> None:
        self.filament_edit.blockSignals(True)
        self.filament_edit.clear()
        self.filament_edit.addItem("(none)", None)
        for color in self._catalog.colors:
            self.filament_edit.addItem(color.combo_label, color.id)
            row = self.filament_edit.count() - 1
            mesh_hex = effective_filament_hex(color.hex, color.display_name, color.product_line)
            if mesh_hex:
                self.filament_edit.setItemData(row, mesh_hex, Qt.UserRole + 1)
        completer = QCompleter([self.filament_edit.itemText(i) for i in range(self.filament_edit.count())])
        completer.setCaseSensitivity(Qt.CaseInsensitive)
        completer.setFilterMode(Qt.MatchContains)
        self.filament_edit.setCompleter(completer)
        if select_id:
            idx = self.filament_edit.findData(select_id)
            if idx >= 0:
                self.filament_edit.setCurrentIndex(idx)
        self.filament_edit.blockSignals(False)

    def _build_assign_filament_menu(self) -> QMenu:
        menu = QMenu(self)
        for role in ("primary", "accent", "clear", "opaque"):
            action = menu.addAction(f"All {role} parts")
            action.triggered.connect(lambda checked=False, r=role: self._bulk_assign_filament(r))
        return menu

    def _selected_filament_color_id(self) -> str | None:
        data = self.filament_edit.currentData()
        if data:
            return str(data)
        text = self.filament_edit.currentText().strip()
        if not text or text == "(none)":
            return None
        for i in range(self.filament_edit.count()):
            if self.filament_edit.itemText(i) == text:
                return self.filament_edit.itemData(i)
        return None

    def _preview_mesh_hex(self) -> str | None:
        """Filament color for the 3D preview (combo selection, not yet saved)."""
        idx = self.filament_edit.currentIndex()
        if idx >= 0:
            from print_partner.core.mesh_color import normalize_mesh_hex

            hex_data = self.filament_edit.itemData(idx, Qt.UserRole + 1)
            if hex_data:
                normalized = normalize_mesh_hex(str(hex_data))
                if normalized:
                    return normalized
        return resolve_filament_hex(self._selected_filament_color_id(), self.role_edit.currentText())

    def _on_preview_color_changed(self) -> None:
        if self.filament_edit.signalsBlocked() or self.role_edit.signalsBlocked():
            return
        if self._selected_part_id() is None:
            return
        self._refresh_stl_preview()

    def _refresh_ambrosia_colors(self) -> None:
        progress = QProgressDialog("Syncing West3D Ambrosia colors…", "Cancel", 0, 100, self)
        progress.setWindowModality(Qt.WindowModal)
        progress.setMinimumDuration(0)
        progress.setValue(0)

        def on_progress(done: int, total: int) -> None:
            progress.setMaximum(max(1, total))
            progress.setLabelText(f"Sampling swatch colors ({done}/{total})…")
            progress.setValue(done)
            from PySide6.QtWidgets import QApplication

            QApplication.processEvents()

        try:
            self._catalog = sync_ambrosia_catalog(on_progress=on_progress)
            self._catalog = load_catalog()
        except Exception as exc:
            progress.close()
            QMessageBox.critical(self, "Ambrosia sync failed", str(exc))
            return
        finally:
            if progress.isVisible():
                progress.close()

        self.catalog_status.setText(catalog_status_text(self._catalog))
        self._populate_filament_combo()
        self._rebuild_filament_filter()
        QMessageBox.information(
            self,
            "Ambrosia colors",
            f"Loaded {len(self._catalog.colors)} colors from West3D.",
        )

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

    def _filament_table_cell(self, p: dict) -> QTableWidgetItem:
        label = p.get("filament_display") or ""
        item = QTableWidgetItem(label or "—")
        hex_color = p.get("filament_hex")
        if hex_color:
            item.setBackground(QColor(hex_color))
            item.setForeground(QColor("#ffffff" if self._is_dark(hex_color) else "#000000"))
        return item

    @staticmethod
    def _is_dark(hex_color: str) -> bool:
        h = hex_color.lstrip("#")
        if len(h) != 6:
            return False
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return (0.299 * r + 0.587 * g + 0.114 * b) < 128

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
                    select_profile_id = int(last)
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
        self._current_profile_id = self.profile_combo.itemData(idx)
        if self._current_profile_id is not None:
            set_setting_value("last_profile_id", str(self._current_profile_id))
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
        with db_session() as session:
            before = len(get_profile_layers(session, self._current_profile_id))
        _dbg(
            "profile_composer._add_addon",
            "before pick",
            {"profile_id": self._current_profile_id, "layer_count": before},
            "H4",
        )
        projects = self._pick_project("Select addon project")
        if not projects:
            _dbg("profile_composer._add_addon", "pick cancelled", {}, "H3")
            return
        with db_session() as session:
            add_addon_project(session, self._current_profile_id, projects[0])
            after = len(get_profile_layers(session, self._current_profile_id))
        _dbg(
            "profile_composer._add_addon",
            "after add",
            {"project_id": projects[0], "layer_count": after},
            "H4",
        )
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
        _dbg(
            "profile_composer._pick_project",
            "dialog choices",
            {"title": title, "count": len(choices), "names": [n for _, n in choices]},
            "H3",
        )
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
        _dbg(
            "profile_composer._pick_project",
            "selected",
            {"project_id": int(pid), "name": item.text()},
            "H3",
        )
        return [int(pid)]

    def _recompute(self) -> None:
        if self._current_profile_id is None:
            return
        try:
            with db_session() as session:
                result = recompute_profile(session, self._current_profile_id)
            if not result.get("merged"):
                QMessageBox.warning(
                    self,
                    "Recompute",
                    "No layers to scan.\n\n"
                    "1. On Projects tab: add repos and Sync selected.\n"
                    "2. Add base project via layers panel.\n"
                    "3. Then Recompute.",
                )
                return
            self._load_parts()
            self.profile_changed.emit()
            self._start_thumbnail_cache()
        except Exception as e:
            QMessageBox.critical(self, "Recompute failed", str(e))

    def _stop_thumbnail_worker(self) -> None:
        from print_partner.debug_trace import debug_log

        running = self._thumb_worker is not None and self._thumb_worker.isRunning()
        # region agent log
        debug_log(
            "profile_composer._stop_thumbnail_worker",
            "enter",
            {"has_worker": self._thumb_worker is not None, "running": running},
            hypothesis_id="A",
        )
        # endregion
        if self._thumb_worker and self._thumb_worker.isRunning():
            self._thumb_worker.cancel()
            waited = self._thumb_worker.wait(8000)
            if not waited and self._thumb_worker.isRunning():
                self._thumb_worker.terminate()
                self._thumb_worker.wait(2000)
            # region agent log
            debug_log(
                "profile_composer._stop_thumbnail_worker",
                "after_wait",
                {
                    "waited": waited,
                    "still_running": self._thumb_worker.isRunning(),
                },
                hypothesis_id="A",
            )
            # endregion
        self._thumb_worker = None

    def shutdown(self) -> None:
        """Stop background work before application exit."""
        from print_partner.debug_trace import debug_log

        # region agent log
        debug_log("profile_composer.shutdown", "enter", {}, hypothesis_id="A", run_id="post-fix")
        # endregion
        self._stop_thumbnail_worker()
        self.stl_viewer.shutdown()

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
        # region agent log
        _dbg(
            "profile_composer._start_thumbnail_cache",
            "worker_start",
            {"job_count": len(jobs)},
            "A",
        )
        # endregion
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

    def _load_parts(self) -> None:
        if self._current_profile_id is None:
            return
        with db_session() as session:
            profile = session.get(BuildProfile, self._current_profile_id)
            parts = get_profile_parts(session, self._current_profile_id)
            part_dicts = [part_to_display_dict(p, session) for p in parts]
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
        _dbg(
            "profile_composer._load_parts",
            "loading panel",
            {
                "profile_id": self._current_profile_id,
                "total_parts": len(part_dicts),
                "filtered_parts": len(filtered_dicts),
                "layer_count": len(layer_dicts),
                "included_in_db": sum(1 for r in part_dicts if r["included"]),
            },
            "H1",
        )
        # Snapshots only — ORM Part rows detach after db_session closes.
        self.parts_panel.load_parts(part_dicts, filtered_dicts)

    def _selected_part_id(self) -> int | None:
        return self._last_selected_part_id

    def _on_visible_parts_changed(self) -> None:
        self._visible_part_ids = self.parts_panel.visible_part_ids()

    def _on_parts_inclusion_changed(self, included_ids: set[int]) -> None:
        if self._current_profile_id is None:
            return
        with db_session() as session:
            all_parts = get_profile_parts(session, self._current_profile_id)
            _dbg(
                "profile_composer._on_parts_inclusion_changed",
                "persist inclusion",
                {
                    "included_ids_count": len(included_ids),
                    "total_parts": len(all_parts),
                    "will_exclude": len(all_parts) - len(included_ids),
                },
                "H1",
            )
            for part in all_parts:
                included = part.id in included_ids
                part.included = included
                if included:
                    if part.status == "excluded":
                        part.status = "base"
                else:
                    part.status = "excluded"
        self._load_parts()

    def _on_print_unit_toggle(self, part_id: int, unit_index: int) -> None:
        with db_session() as session:
            part = session.get(Part, part_id)
            if not part:
                return
            units = get_print_units(session, part_id, part.quantity_effective)
            current = units[unit_index] if unit_index < len(units) else False
            set_unit_completed(session, part_id, unit_index, not current)
        self._reload_print_progress_ui()

    def _reload_print_progress_ui(self) -> None:
        if self._current_profile_id is None:
            return
        with db_session() as session:
            parts = get_profile_parts(session, self._current_profile_id)
            part_dicts = [part_to_display_dict(p, session) for p in parts]
        visible = self._visible_part_ids
        filtered_dicts = [d for d in part_dicts if d["id"] in visible]
        self.parts_panel.load_parts(part_dicts, filtered_dicts)

    def _on_part_selected_by_id(self, part_id: int) -> None:
        self._last_selected_part_id = part_id
        self._on_part_selected()

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
            self.role_edit.blockSignals(True)
            self.role_edit.setCurrentText(part.role)
            self.role_edit.blockSignals(False)
            self.filament_edit.blockSignals(True)
            self._populate_filament_combo(select_id=part.filament_color_id)
            self.filament_edit.blockSignals(False)
            mesh_hex = self._preview_mesh_hex()
            self.qty_spin.setValue(part.quantity_effective)
            self.notes_edit.setPlainText(part.notes or "")
            stl_resolved = resolve_part_stl_path(session, part)
            if stl_resolved:
                stl_path = stl_resolved
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
        self.docs_panel.load_readme(repo_path)
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
                mesh_hex = resolve_filament_hex(part.filament_color_id, part.role)
                invalidate_global_thumbnails(stl, part.role, mesh_hex, all_variants=True)

    def _save_overrides(self) -> None:
        pid = self._selected_part_id()
        if pid is None:
            _dbg("profile_composer._save_overrides", "no selection", {}, "H5")
            return
        with db_session() as session:
            part = session.get(Part, pid)
            if part:
                part.role = self.role_edit.currentText()
                part.filament_color_id = self._selected_filament_color_id()
                part.quantity_override = self.qty_spin.value()
                part.quantity_effective = self.qty_spin.value()
                part.notes = self.notes_edit.toPlainText()
                _dbg(
                    "profile_composer._save_overrides",
                    "saved",
                    {
                        "part_id": pid,
                        "role": part.role,
                        "qty": part.quantity_effective,
                    },
                    "H5",
                )
        self._invalidate_part_thumbnails(pid)
        self._load_parts()
        self._refresh_stl_preview()
        self._start_thumbnail_cache()

    def _bulk_assign_filament(self, role: str) -> None:
        if self._current_profile_id is None:
            return
        color_id = self._selected_filament_color_id()
        if not color_id:
            QMessageBox.information(self, "Assign filament", "Select a filament color first.")
            return
        use_visible = bool(self._visible_part_ids) and (
            self._status_filter
            or self.role_combo.currentText()
            or self.filament_filter.currentData() not in ("", None)
            or self.included_only.currentIndex() != 0
        )
        if use_visible:
            with db_session() as session:
                updated = 0
                for part in get_profile_parts(session, self._current_profile_id):
                    if part.id not in self._visible_part_ids or part.role != role:
                        continue
                    part.filament_color_id = color_id
                    updated += 1
        else:
            with db_session() as session:
                updated = bulk_set_filament_color(
                    session, self._current_profile_id, role, color_id, included_only=False
                )
        self._load_parts()
        self._start_thumbnail_cache()
        QMessageBox.information(
            self,
            "Assign filament",
            f"Set filament on {updated} {role} part(s).",
        )

    def _apply_filters(self) -> None:
        self._status_filter = self.status_combo.currentText()
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
            merge_parts: list[MergePart] = []
            completed_by_key: dict[str, list[bool]] = {}
            from print_partner.core.ambrosia_catalog import get_color_by_id

            for r in rows:
                color = get_color_by_id(r.filament_color_id)
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
                    filament_hex=color.hex if color else None,
                    filament_swatch_url=color.swatch_url if color else "",
                )
                stl = resolve_part_stl_path(session, r)
                if stl:
                    mp.absolute_path = stl
                merge_parts.append(mp)
                completed_by_key[r.match_key] = get_print_units(
                    session, r.id, r.quantity_effective
                )
        return name, order_number, merge_parts, completed_by_key

    def _export_html(self) -> None:
        if self._current_profile_id is None:
            return
        name, order_number, merge_parts, completed_by_key = self._merge_parts_for_export()
        included = [p for p in merge_parts if p.included]
        progress = QProgressDialog("Preparing export…", "Cancel", 0, max(1, len(included)), self)
        progress.setWindowModality(Qt.WindowModal)
        progress.setMinimumDuration(0)
        progress.setValue(0)
        cancelled = {"flag": False}

        def on_progress(current: int, total: int, filename: str) -> None:
            progress.setMaximum(max(1, total))
            progress.setLabelText(f"Generating thumbnails ({current}/{total}):\n{filename}")
            progress.setValue(current)
            from PySide6.QtWidgets import QApplication

            QApplication.processEvents()
            if progress.wasCanceled():
                cancelled["flag"] = True

        def cancel_check() -> bool:
            return cancelled["flag"]

        out = export_path_for_profile(name, settings.exports_dir)
        try:
            out, part_count, thumb_count = export_profile_html(
                name,
                merge_parts,
                out,
                on_progress=on_progress,
                cancel_check=cancel_check,
                order_number=order_number,
                profile_id=self._current_profile_id,
                completed_by_match_key=completed_by_key,
            )
        finally:
            progress.close()

        if cancelled["flag"]:
            QMessageBox.information(self, "Export", "Export cancelled.")
            return

        self._last_export_path = out
        reply = QMessageBox.question(
            self,
            "Export",
            f"Saved to:\n{out}\n\n"
            f"{part_count} parts, {thumb_count} thumbnails "
            f"(stl-thumb or built-in PyVista).\n\n"
            f"Open in your browser now?",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.Yes,
        )
        if reply == QMessageBox.Yes:
            self._open_html_path(out)

    def _export_stls(self) -> None:
        if self._current_profile_id is None:
            return
        name, _, merge_parts, _ = self._merge_parts_for_export()
        included = [p for p in merge_parts if p.included]
        total = sum(max(1, p.quantity_effective) for p in included)
        progress = QProgressDialog("Exporting STLs…", "Cancel", 0, max(1, total), self)
        progress.setWindowModality(Qt.WindowModal)
        progress.setMinimumDuration(0)
        cancelled = {"flag": False}

        def on_progress(done: int, tot: int, filename: str) -> None:
            progress.setMaximum(max(1, tot))
            progress.setLabelText(f"Exporting ({done}/{tot}):\n{filename}")
            progress.setValue(done)
            from PySide6.QtWidgets import QApplication

            QApplication.processEvents()
            if progress.wasCanceled():
                cancelled["flag"] = True

        try:
            root, zip_counts, warnings = export_profile_stl_zips(
                name,
                merge_parts,
                settings.exports_dir,
                on_progress=on_progress,
                cancel_check=lambda: cancelled["flag"],
            )
        finally:
            progress.close()

        summary = "\n".join(f"  {role}: {count} zip(s)" for role, count in zip_counts.items())
        msg = f"Saved to:\n{root}\n\n{summary or 'No zips created.'}"
        if warnings:
            msg += f"\n\n{len(warnings)} warning(s), e.g.:\n" + "\n".join(warnings[:5])
        if not zip_counts and not included:
            msg += "\n\nNo included parts to export."
        elif not zip_counts and included:
            msg += "\n\nNo STL files found on disk. Sync projects on the Projects tab first."
        QMessageBox.information(self, "Export STLs", msg)

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
