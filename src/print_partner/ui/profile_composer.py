"""Profiles tab — layers, merge, parts table."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QGroupBox,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QMenu,
    QMessageBox,
    QProgressDialog,
    QPushButton,
    QSpinBox,
    QSplitter,
    QStackedWidget,
    QTabWidget,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from print_partner.config import settings
from print_partner.core.ambrosia_catalog import (
    AmbrosiaCatalog,
    catalog_status_text,
    load_catalog,
)
from print_partner.core.export_html import export_path_for_profile, open_html_file
from print_partner.core.export_kit_bundle import (
    KIT_EXTENSION,
    export_kit_bundle,
    export_path_for_kit,
    import_kit_bundle,
)
from print_partner.core.filament_color_resolve import resolve_part_filament_hex
from print_partner.core.merge import MergePart
from print_partner.core.part_paths import (
    build_profile_stl_index,
    resolve_part_stl_path,
    thumbnail_jobs_for_profile,
)
from print_partner.core.print_checklist import enrich_thumbnail_paths
from print_partner.core.print_progress import (
    print_units_by_part_id,
)
from print_partner.db.models import BuildProfile, Project
from print_partner.db.session import (
    db_session,
    get_profile_layers,
    get_profile_parts,
    get_setting_value,
    list_profiles,
    part_to_display_dict,
    set_setting_value,
)
from print_partner.ui.ai_assistant_panel import AiAssistantPanel
from print_partner.ui.catalog_sync_worker import CatalogSyncWorker
from print_partner.ui.composer import AiIntegrationMixin, KitActionsMixin, PartsViewMixin
from print_partner.ui.docs_panel import DocsPanel
from print_partner.ui.empty_state import EmptyStateWidget
from print_partner.ui.export_worker import ExportWorker, HtmlExportResult, StlExportResult
from print_partner.ui.filament_picker_widget import FilamentPickerWidget
from print_partner.ui.profile_layers_panel import ProfileLayersPanel
from print_partner.ui.profile_parts_panel import ProfilePartsPanel
from print_partner.ui.recompute_worker import RecomputeWorker
from print_partner.ui.stl_viewer import StlViewer
from print_partner.ui.thumbnail_cache_worker import ThumbnailCacheWorker

KitSubMode = Literal["compose", "review"]
TopViewMode = Literal["kit", "checkoff"]


class ProfileComposer(PartsViewMixin, KitActionsMixin, AiIntegrationMixin, QWidget):
    profile_changed = Signal()
    navigate_requested = Signal(str)  # libraries | kit | checkoff | compose | review
    back_to_kit_library = Signal()

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
        self._top_mode: TopViewMode = "kit"
        self._kit_sub_mode: KitSubMode = "compose"
        self._cached_part_dicts: list[dict] = []
        self._cached_readme_paths: list[Path] = []
        self._cached_reference_layers: list | None = None
        self._ref_layers_cache_key: str | None = None
        self._load_parts_timer = QTimer(self)
        self._load_parts_timer.setSingleShot(True)
        self._load_parts_timer.setInterval(50)
        self._load_parts_timer.timeout.connect(self._load_parts_now)

        root = QVBoxLayout(self)

        self._kit_header = QWidget()
        kit_header_layout = QVBoxLayout(self._kit_header)
        kit_header_layout.setContentsMargins(0, 0, 0, 0)

        kit_row = QHBoxLayout()
        self.btn_all_kits = QPushButton("← All kits")
        self.btn_all_kits.clicked.connect(self.back_to_kit_library.emit)
        kit_row.addWidget(self.btn_all_kits)
        self.profile_combo = QComboBox()
        self.profile_combo.currentIndexChanged.connect(self._on_profile_selected)
        kit_row.addWidget(QLabel("Kit:"))
        kit_row.addWidget(self.profile_combo, 1)
        kit_row.addWidget(QLabel("Order #:"))
        self.order_number_edit = QLineEdit()
        self.order_number_edit.setPlaceholderText("Optional")
        self.order_number_edit.setMaximumWidth(140)
        self.order_number_edit.editingFinished.connect(self._save_order_number)
        kit_row.addWidget(self.order_number_edit)
        self.btn_manage = QPushButton("Manage ▾")
        manage_menu = QMenu(self)
        manage_menu.addAction("Rename…", self._manage_rename)
        manage_menu.addAction("Delete…", self._manage_delete)
        manage_menu.addAction("Duplicate in database…", self._manage_duplicate_db)
        manage_menu.addAction("Edit in wizard…", self._manage_edit_wizard)
        manage_menu.addSeparator()
        manage_menu.addAction("Export kit for sharing…", self._export_kit_bundle)
        manage_menu.addAction("Import shared kit…", self._import_kit_bundle)
        self.btn_manage.setMenu(manage_menu)
        kit_row.addWidget(self.btn_manage)
        kit_header_layout.addLayout(kit_row)

        self.btn_new_build = QPushButton("New build…")
        self.btn_new_build.setObjectName("primaryButton")
        self.btn_new_build.clicked.connect(self._new_build_wizard)
        self.btn_duplicate_build = QPushButton("Duplicate build")
        self.btn_duplicate_build.clicked.connect(self._duplicate_build_wizard)
        self._btn_new_profile = QPushButton("New profile")
        self._btn_new_profile.clicked.connect(self._new_profile)
        self.btn_refresh_colors = QPushButton("Refresh Ambrosia colors")
        self.btn_refresh_colors.clicked.connect(self._refresh_ambrosia_colors)
        build_advanced = QMenu(self)
        build_advanced.addAction("New profile", self._new_profile)
        build_advanced.addAction("Refresh Ambrosia colors", self._refresh_ambrosia_colors)
        self._btn_build_advanced = QPushButton("Advanced ▾")
        self._btn_build_advanced.setMenu(build_advanced)

        build_bar = QWidget()
        build_layout = QHBoxLayout(build_bar)
        build_layout.setContentsMargins(0, 0, 0, 0)
        self.btn_recompute = QPushButton("Recompute")
        self.btn_recompute.clicked.connect(self._recompute)
        build_layout.addWidget(self.btn_new_build)
        build_layout.addWidget(self.btn_recompute)
        build_layout.addWidget(self.btn_duplicate_build)
        build_layout.addWidget(self._btn_build_advanced)
        self.btn_next_review = QPushButton("Next: Review kit →")
        self.btn_next_review.clicked.connect(lambda: self.navigate_requested.emit("review"))
        build_layout.addWidget(self.btn_next_review)
        build_layout.addStretch(1)

        verify_bar = QWidget()
        verify_layout = QHBoxLayout(verify_bar)
        verify_layout.setContentsMargins(0, 0, 0, 0)
        self._verify_action_hint = QLabel(
            "Review included parts only — uncheck Print to exclude before checkoff."
        )
        self._verify_action_hint.setProperty("muted", True)
        self._verify_action_hint.setWordWrap(True)
        verify_layout.addWidget(self._verify_action_hint, 1)
        self.btn_back_compose = QPushButton("← Back to Compose")
        self.btn_back_compose.clicked.connect(lambda: self.navigate_requested.emit("compose"))
        verify_layout.addWidget(self.btn_back_compose)
        self.btn_go_checkoff = QPushButton("Go to Checkoff →")
        self.btn_go_checkoff.setObjectName("primaryButton")
        self.btn_go_checkoff.clicked.connect(lambda: self.navigate_requested.emit("checkoff"))
        verify_layout.addWidget(self.btn_go_checkoff)

        self._btn_export_html = QPushButton("Export checklist")
        self._btn_export_html.setObjectName("primaryButton")
        self._btn_export_html.clicked.connect(self._export_html)
        self._btn_export_stls = QPushButton("Export STLs…")
        self._btn_export_stls.clicked.connect(self._export_stls)
        self._btn_export_all = QPushButton("Export all")
        self._btn_export_all.clicked.connect(self._export_all)
        self._btn_open_html = QPushButton("Open HTML")
        self._btn_open_html.clicked.connect(self._open_html)
        checkoff_more = QMenu(self)
        checkoff_more.addAction("Export STLs…", self._export_stls)
        checkoff_more.addAction("Export all", self._export_all)
        checkoff_more.addAction("Open HTML", self._open_html)
        self._btn_checkoff_more = QPushButton("More ▾")
        self._btn_checkoff_more.setMenu(checkoff_more)

        checkoff_bar = QWidget()
        checkoff_layout = QHBoxLayout(checkoff_bar)
        checkoff_layout.setContentsMargins(0, 0, 0, 0)
        self._checkoff_hint = QLabel("Export checklist when ready for the shop floor.")
        self._checkoff_hint.setProperty("muted", True)
        checkoff_layout.addWidget(self._checkoff_hint)
        checkoff_layout.addWidget(self._btn_export_html)
        checkoff_layout.addWidget(self._btn_checkoff_more)
        checkoff_layout.addStretch(1)

        self._action_stack = QStackedWidget()
        self._action_stack.addWidget(build_bar)
        self._action_stack.addWidget(verify_bar)
        self._action_stack.addWidget(checkoff_bar)
        kit_header_layout.addWidget(self._action_stack)
        root.addWidget(self._kit_header)

        self._kit_stack = QStackedWidget()
        self._empty_profiles = EmptyStateWidget(
            "No builds yet",
            "Create a build profile from your synced repositories using the wizard. "
            "Start on the Libraries tab to add and sync repos.",
            cta_text="New build…",
        )
        self._empty_profiles.cta_clicked.connect(self._new_build_wizard)
        self._kit_stack.addWidget(self._empty_profiles)

        self._kit_body = QWidget()
        body = QVBoxLayout(self._kit_body)
        body.setContentsMargins(0, 0, 0, 0)

        self.catalog_status = QLabel(catalog_status_text(self._catalog))
        self.catalog_status.setProperty("muted", True)
        body.addWidget(self.catalog_status)

        self.thumb_status = QLabel("Thumbnails: run Recompute to cache in background")
        self.thumb_status.setProperty("muted", True)
        body.addWidget(self.thumb_status)

        self._kit_empty_parts_banner = QLabel(
            "No parts in this kit — import STLs on Libraries, then use Recompute "
            "or New build… to populate the tree."
        )
        self._kit_empty_parts_banner.setProperty("muted", True)
        self._kit_empty_parts_banner.setWordWrap(True)
        self._kit_empty_parts_banner.hide()
        body.addWidget(self._kit_empty_parts_banner)

        self._recompute_banner = QLabel("")
        self._recompute_banner.setWordWrap(True)
        self._recompute_banner.hide()
        banner_row = QHBoxLayout()
        banner_row.setContentsMargins(0, 0, 0, 0)
        banner_row.addWidget(self._recompute_banner, 1)
        self._btn_recompute_banner = QPushButton("Recompute now")
        self._btn_recompute_banner.clicked.connect(self._recompute)
        self._btn_recompute_banner.hide()
        banner_row.addWidget(self._btn_recompute_banner)
        banner_host = QWidget()
        banner_host.setLayout(banner_row)
        body.addWidget(banner_host)

        self._verify_summary = QLabel("")
        self._verify_summary.setProperty("muted", True)
        self._verify_summary.setWordWrap(True)
        body.addWidget(self._verify_summary)

        self.layers_panel = ProfileLayersPanel()
        self.layers_panel.set_base_requested.connect(self._set_base)
        self.layers_panel.add_addon_requested.connect(self._add_addon)
        self.layers_panel.change_project_requested.connect(self._change_layer_project)
        self.layers_panel.remove_addon_requested.connect(self._remove_layer)
        self.layers_panel.recompute_requested.connect(self._recompute)
        body.addWidget(self.layers_panel)

        self._filters_group = QGroupBox("Advanced filters")
        self._filters_group.setCheckable(True)
        self._filters_group.setChecked(False)
        filters_inner = QWidget()
        filters = QHBoxLayout(filters_inner)
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
        group_layout = QVBoxLayout(self._filters_group)
        group_layout.addWidget(filters_inner)
        filters_inner.setVisible(False)
        self._filters_group.toggled.connect(filters_inner.setVisible)
        body.addWidget(self._filters_group)

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
        right_layout.setContentsMargins(0, 0, 0, 0)
        self._inspector_tabs = QTabWidget()
        self.stl_viewer = StlViewer()
        self.docs_panel = DocsPanel()
        self.ai_panel = AiAssistantPanel()
        self.ai_panel.set_context_provider(self._build_ai_context)
        self.ai_panel.set_snapshot_provider(self._ai_snapshot)
        self.ai_panel.apply_actions_requested.connect(self._on_ai_apply_actions)
        self.ai_panel.settings_requested.connect(self._show_ai_settings)
        self.ai_panel.refresh_enabled_state()
        self._inspector_tabs.addTab(self.stl_viewer, "Preview")
        self._inspector_tabs.addTab(self.docs_panel, "Docs")
        self._inspector_tabs.addTab(self.ai_panel, "Assistant")
        right_layout.addWidget(self._inspector_tabs, 1)
        self._splitter_right = right
        splitter.addWidget(right)
        splitter.setSizes([500, 400])
        body.addWidget(splitter, 1)

        self._kit_stack.addWidget(self._kit_body)
        root.addWidget(self._kit_stack, 1)
        self.refresh_profiles()
        self.set_view_mode("kit")
        self.set_kit_sub_mode("compose")

    def kit_sub_mode(self) -> KitSubMode:
        return self._kit_sub_mode

    @property
    def _is_checkoff(self) -> bool:
        return self._top_mode == "checkoff"

    @property
    def _is_kit_review(self) -> bool:
        return self._top_mode == "kit" and self._kit_sub_mode == "review"

    @property
    def _is_kit_compose(self) -> bool:
        return self._top_mode == "kit" and self._kit_sub_mode == "compose"

    def _update_kit_visibility(self) -> None:
        no_profiles = self.profile_combo.count() == 0
        has_profile = self._current_profile_id is not None
        self._kit_header.setVisible(not no_profiles)
        self._kit_stack.setCurrentIndex(0 if no_profiles else 1)
        self.order_number_edit.setEnabled(has_profile)
        self.btn_manage.setEnabled(has_profile)

    def set_view_mode(
        self,
        mode: Literal["kit", "checkoff", "build", "verify"],
        *,
        reload_parts: bool = False,
    ) -> None:
        if mode in ("build", "compose"):
            self._top_mode = "kit"
            self._kit_sub_mode = "compose"
        elif mode in ("verify", "review"):
            self._top_mode = "kit"
            self._kit_sub_mode = "review"
        elif mode == "kit":
            self._top_mode = "kit"
        else:
            self._top_mode = "checkoff"
        self._apply_view_state()
        if reload_parts:
            self._schedule_load_parts()
        else:
            self.refresh_view_from_cache()

    def show_recompute_banner(self, message: str) -> None:
        self._recompute_banner.setText(message)
        self._recompute_banner.show()
        self._btn_recompute_banner.show()

    def dismiss_recompute_banner(self) -> None:
        self._recompute_banner.hide()
        self._btn_recompute_banner.hide()

    def set_kit_sub_mode(self, sub: KitSubMode, *, reload_parts: bool = False) -> None:
        self._kit_sub_mode = sub
        if self._top_mode == "kit":
            self._apply_view_state()
            if reload_parts:
                self._schedule_load_parts()
            else:
                self.refresh_view_from_cache()

    def open_profile(self, profile_id: int) -> None:
        self.reload_profile_list(select_profile_id=profile_id, reload_parts=True)

    def reload_profile_list(
        self,
        select_profile_id: int | None = None,
        *,
        reload_parts: bool = False,
    ) -> None:
        self.refresh_profiles(select_profile_id=select_profile_id, reload_parts=reload_parts)

    def refresh_view_from_cache(self) -> None:
        if not self._cached_part_dicts or self._current_profile_id is None:
            return
        part_dicts = self._cached_part_dicts
        if self._is_checkoff:
            profile_name = ""
            order_number: str | None = None
            if self._current_profile_id is not None:
                with db_session() as session:
                    profile = session.get(BuildProfile, self._current_profile_id)
                    if profile:
                        profile_name = profile.name
                        order_number = profile.order_number
            self.parts_panel.print_checklist.set_header(profile_name, order_number)
            self.parts_panel.print_checklist.load_rows(part_dicts)
            return
        if self._is_kit_review:
            visible = self._visible_part_ids
            filtered_dicts = [d for d in part_dicts if d["id"] in visible]
            self.parts_panel.refresh_progress_rows(part_dicts, filtered_dicts)
            self._update_verify_summary(part_dicts)
            return
        if self._is_kit_compose:
            self._apply_compose_parts_ui(part_dicts)

    @staticmethod
    def _profile_label(name: str, order_number: str | None) -> str:
        if order_number:
            return f"{name} — Order {order_number}"
        return name

    def refresh_profiles(
        self,
        select_profile_id: int | None = None,
        *,
        reload_parts: bool = True,
    ) -> None:
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
            new_id = self.profile_combo.itemData(restore_index)
            profile_changed = new_id != self._current_profile_id
            self._current_profile_id = new_id
            if self._current_profile_id is not None:
                set_setting_value("last_profile_id", str(self._current_profile_id))
            if profile_changed:
                self._restore_filter_state()
                self.parts_panel.suggestions_panel.reset_dismissed()
            if reload_parts:
                self._schedule_load_parts()
        else:
            self._current_profile_id = None
            self._clear_parts_table()
        self._update_kit_visibility()

    def _on_profile_selected(self, index: int = -1) -> None:
        idx = index if index >= 0 else self.profile_combo.currentIndex()
        if idx < 0:
            self._current_profile_id = None
            self._clear_parts_table()
            self._update_kit_visibility()
            return
        new_id = self.profile_combo.itemData(idx)
        profile_changed = new_id != self._current_profile_id
        self._current_profile_id = new_id
        if self._current_profile_id is not None:
            set_setting_value("last_profile_id", str(self._current_profile_id))
        if profile_changed:
            self._restore_filter_state()
            self.parts_panel.suggestions_panel.reset_dismissed()
            self._ref_layers_cache_key = None
        self._update_kit_visibility()
        self._schedule_load_parts()

    def _clear_parts_table(self) -> None:
        self.parts_panel.load_parts([], [])
        self.layers_panel.load_layers([])
        self.order_number_edit.clear()

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
        self.ai_panel.shutdown()
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
        if self._is_checkoff and self._current_profile_id is not None:
            self._load_parts()

    def _load_parts_now(self) -> None:
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
            readme_paths = self._readme_paths_for_profile(session, layers)
            reference_layers: list | None = None
            if self._is_kit_compose:
                cache_key = f"{self._current_profile_id}"
                if cache_key == self._ref_layers_cache_key and self._cached_reference_layers is not None:
                    reference_layers = self._cached_reference_layers
                else:
                    reference_layers = self._reference_layers_for_profile(session, layers, parts)
                    self._cached_reference_layers = reference_layers
                    self._ref_layers_cache_key = cache_key
            has_synced_layer = False
            for layer in layers:
                if not layer.project_id:
                    continue
                proj = session.get(Project, layer.project_id)
                if proj and proj.local_path:
                    has_synced_layer = True
                    break
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
        self._cached_part_dicts = part_dicts
        self._cached_readme_paths = readme_paths
        self.parts_panel.load_parts(
            part_dicts,
            filtered_dicts,
            readme_repo_paths=readme_paths,
            reference_layers=reference_layers,
            profile_name=profile_name,
            order_number=order_number,
        )
        self._update_verify_summary(part_dicts)
        self.ai_panel.refresh_context_snapshot()
        self._update_kit_empty_banner(len(part_dicts), has_synced_layer)
        if not part_dicts:
            self._try_restore_wiped_profile()

    def _update_kit_empty_banner(self, part_count: int, has_synced_layer: bool) -> None:
        if not self._is_kit_compose:
            self._kit_empty_parts_banner.hide()
            return
        show = part_count == 0 and has_synced_layer
        self._kit_empty_parts_banner.setVisible(show)

    @staticmethod
    def _readme_paths_for_profile(session, layers) -> list[Path]:
        paths: list[Path] = []
        seen: set[str] = set()
        for layer in layers:
            if not layer.project_id:
                continue
            proj = session.get(Project, layer.project_id)
            if not proj or not proj.local_path:
                continue
            key = proj.local_path
            if key in seen:
                continue
            seen.add(key)
            root = Path(proj.local_path)
            if root.is_dir():
                paths.append(root)
        return paths

    @staticmethod
    def _reference_layers_for_profile(session, layers, parts) -> list[tuple[str, list, set[str]]]:
        from print_partner.core.import_rules import import_rules_for_project
        from print_partner.core.scanner import scan_repo

        out: list[tuple[str, list, set[str]]] = []
        for layer in layers:
            if not layer.project_id:
                continue
            proj = session.get(Project, layer.project_id)
            if not proj or not proj.local_path:
                continue
            root = Path(proj.local_path)
            if not root.is_dir():
                continue
            label = f"{layer.layer_type}:{proj.name}"
            rules = import_rules_for_project(proj.imported_paths)
            scanned = scan_repo(root, label, import_rules=rules)
            included_keys = {
                p.match_key for p in parts if p.source_layer == label and p.included
            }
            out.append((label, scanned, included_keys))
        return out




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
                msg += "\n\nNo STL files found on disk. Sync projects on the Libraries tab first."
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

    def _export_kit_bundle(self) -> None:
        if self._current_profile_id is None:
            QMessageBox.information(self, "Export kit", "Select a kit first.")
            return
        name = self.profile_combo.currentText().strip() or "kit"
        default_path = export_path_for_kit(name, settings.exports_dir)
        chosen, _ = QFileDialog.getSaveFileName(
            self,
            "Export kit for sharing",
            str(default_path),
            f"Print Partner kit (*{KIT_EXTENSION})",
        )
        if not chosen:
            return
        dest = Path(chosen)
        try:
            with db_session() as session:
                export_kit_bundle(session, self._current_profile_id, dest)
        except (OSError, ValueError) as exc:
            QMessageBox.critical(self, "Export kit", str(exc))
            return
        from print_partner.ui.toast import show_toast

        show_toast(self, f"Kit saved to {dest.name} — share this file with your print partner.")

    def _import_kit_bundle(self) -> None:
        start = str(settings.exports_dir) if settings.exports_dir.is_dir() else ""
        chosen, _ = QFileDialog.getOpenFileName(
            self,
            "Import shared kit",
            start,
            f"Print Partner kit (*{KIT_EXTENSION});;JSON (*.json)",
        )
        if not chosen:
            return
        name, ok = QInputDialog.getText(
            self,
            "Import kit",
            "Kit name (optional):",
        )
        if not ok:
            return
        try:
            with db_session() as session:
                result = import_kit_bundle(
                    session,
                    Path(chosen),
                    new_name=name.strip() or None,
                )
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            QMessageBox.critical(self, "Import kit", str(exc))
            return
        self.refresh_profiles(select_profile_id=result.profile_id)
        self.profile_changed.emit()
        lines = [
            f"Imported “{result.profile_name}” ({result.parts_imported} parts, "
            f"{result.layers_imported} layers)."
        ]
        if result.unmatched_projects:
            lines.append(
                "Missing repos: " + ", ".join(result.unmatched_projects[:5])
                + " — add them on Libraries."
            )
        QMessageBox.information(self, "Import kit", "\n".join(lines))

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
