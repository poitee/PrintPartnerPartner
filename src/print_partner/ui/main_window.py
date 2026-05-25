"""Main application window."""

from __future__ import annotations

import base64

from PySide6.QtCore import QByteArray, QUrl
from PySide6.QtGui import QAction, QCloseEvent, QDesktopServices, QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMenuBar,
    QMessageBox,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from print_partner import __version__
from print_partner.config import settings
from print_partner.core.export_3mf import Export3mfOptions
from print_partner.db.session import (
    db_session,
    get_profile_layers,
    get_profile_parts,
    get_setting_value,
    list_projects,
    set_setting_value,
)
from print_partner.support_links import KOFI_URL, open_kofi
from print_partner.ui.ai_settings_dialog import AiSettingsDialog
from print_partner.ui.banner_widget import BannerWidget
from print_partner.ui.first_run_dialog import maybe_show_first_run
from print_partner.ui.kit_library import KitLibraryWidget
from print_partner.ui.legal_notices_dialog import LegalNoticesDialog
from print_partner.ui.print_plan_tab import PrintPlanTab
from print_partner.ui.profile_composer import ProfileComposer
from print_partner.ui.tabs.source_tab import SourceTab
from print_partner.ui.workflow_guide_dialog import WorkflowGuideDialog
from print_partner.ui.workflow_strip import WorkflowStrip

_TAB_LIBRARIES = 0
_TAB_KIT = 1
_TAB_PRINT = 2
_TAB_CHECKOFF = 3

_STEP_NAMES = ("Libraries", "Kit", "Print", "Checkoff")
_LOCK_MESSAGES = {
    _TAB_PRINT: "Open a kit from the Kit tab before planning print jobs.",
    _TAB_CHECKOFF: "Open a kit with at least one included part before checkoff.",
}


class TabHost(QWidget):
    """Host for ProfileComposer on Kit and Checkoff (shared kit stack)."""


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Print Partner")
        self.resize(1200, 800)
        self._restored_ui = False
        self._workflow_index = _TAB_LIBRARIES

        self.workflow_strip = WorkflowStrip()
        self._workflow_banner = BannerWidget()
        self._workflow_banner.hide()

        self._content_stack = QStackedWidget()
        self.source_tab = SourceTab()
        self.source_tab.project_library.import_completed.connect(
            self._on_import_files_completed
        )

        self._kit_host = TabHost()
        kit_layout = QVBoxLayout(self._kit_host)
        kit_layout.setContentsMargins(0, 0, 0, 0)
        self._kit_nav = QStackedWidget()
        self.kit_library = KitLibraryWidget()
        self.kit_library.navigate_libraries.connect(self._go_libraries)
        self._kit_nav.addWidget(self.kit_library)
        kit_layout.addWidget(self._kit_nav)
        self.kit_library.open_kit.connect(self._on_open_kit)
        self.kit_library.list_changed.connect(self._on_kit_list_changed)

        self._content_stack.addWidget(self.source_tab)
        self._content_stack.addWidget(self._kit_host)

        self.print_tab = PrintPlanTab()
        self.print_tab.open_kit_library_requested.connect(self._on_print_open_kit_library)
        self._content_stack.addWidget(self.print_tab)
        self.print_tab.export_3mf_requested.connect(self._on_print_tab_export_3mf)

        self._profiles: ProfileComposer | None = None
        self.workflow_strip.step_clicked.connect(self._on_workflow_step_clicked)
        self.workflow_strip.kit_submode_clicked.connect(self._on_kit_submode_clicked)
        self.source_tab.projects_changed.connect(self._on_projects_changed)

        central = QWidget()
        central_layout = QVBoxLayout(central)
        central_layout.setContentsMargins(0, 0, 0, 0)
        central_layout.setSpacing(0)
        central_layout.addWidget(self.workflow_strip)
        central_layout.addWidget(self._workflow_banner)
        central_layout.addWidget(self._content_stack, 1)
        self.setCentralWidget(central)
        self._install_menu_bar()
        self._install_shortcuts()
        self._install_status_bar_widgets()

    @property
    def workflow_index(self) -> int:
        return self._workflow_index

    def _active_profile_id(self) -> int | None:
        composer = self._profiles
        if composer is None:
            return None
        return composer._current_profile_id

    def _included_part_count(self, profile_id: int) -> int:
        with db_session() as session:
            parts = get_profile_parts(session, profile_id)
            return sum(1 for p in parts if p.included)

    def _workflow_step_locked(self, index: int) -> bool:
        if index == _TAB_PRINT:
            return self._active_profile_id() is None
        if index == _TAB_CHECKOFF:
            pid = self._active_profile_id()
            if pid is None:
                return True
            return self._included_part_count(pid) == 0
        return False

    def _refresh_workflow_strip_state(self) -> None:
        has_projects = False
        with db_session() as session:
            has_projects = len(list_projects(session)) > 0
        pid = self._active_profile_id()
        included = self._included_part_count(pid) if pid is not None else 0

        for i in range(4):
            self.workflow_strip.set_step_locked(i, self._workflow_step_locked(i))
        self.workflow_strip.set_step_complete(_TAB_LIBRARIES, has_projects)
        self.workflow_strip.set_step_complete(_TAB_KIT, included > 0)
        self.workflow_strip.set_kit_submode_visible(self._kit_sub_row_visible())

    def _kit_sub_row_visible(self) -> bool:
        if self._profiles is None:
            return False
        if self._kit_nav.currentWidget() is not self._profiles:
            return False
        return self._workflow_index in (_TAB_KIT, _TAB_CHECKOFF)

    def _set_workflow_index(self, index: int, *, persist: bool = True) -> None:
        if index < 0 or index > _TAB_CHECKOFF:
            return
        if self._workflow_step_locked(index):
            self._workflow_banner.show_message(_LOCK_MESSAGES.get(index, "Complete earlier steps first."))
            if index == _TAB_PRINT:
                self._set_workflow_index(_TAB_KIT, persist=persist)
            elif index == _TAB_CHECKOFF:
                composer = self._profiles
                if composer is not None and composer._current_profile_id is not None:
                    self._set_workflow_index(_TAB_KIT, persist=persist)
                    composer.set_kit_sub_mode("review")
                    self.workflow_strip.set_kit_submode("review")
            return
        self._workflow_banner.hide_banner()
        if index == _TAB_CHECKOFF:
            composer = self._profiles
            if composer is not None and not self._check_checkoff_allowed(composer, use_modal=True):
                return
        self._workflow_index = index
        self.workflow_strip.set_current_step(index)
        self._on_tab_changed(index)
        self._on_tab_changed_workflow_strip(index)
        self._refresh_workflow_strip_state()
        self._update_status_bar()
        if persist:
            set_setting_value("last_tab_index", str(index))
            composer = self._profiles
            if composer is not None and index == _TAB_KIT:
                set_setting_value("last_kit_submode", composer.kit_sub_mode())

    def _install_status_bar_widgets(self) -> None:
        sb = self.statusBar()
        self._status_context = QLabel()
        sb.addWidget(self._status_context, 1)
        hints = QWidget()
        hints_layout = QHBoxLayout(hints)
        hints_layout.setContentsMargins(0, 0, 8, 0)
        hints_layout.setSpacing(12)
        hint_label = QLabel("Ctrl+1–4 steps · F1 guide")
        hint_label.setProperty("statusMono", True)
        hints_layout.addWidget(hint_label)
        self._btn_status_data = QPushButton("Data folder")
        self._btn_status_data.setObjectName("linkButton")
        self._btn_status_data.setFlat(True)
        self._btn_status_data.clicked.connect(self._open_data_folder)
        hints_layout.addWidget(self._btn_status_data)
        sb.addPermanentWidget(hints)

    def _install_menu_bar(self) -> None:
        bar = QMenuBar(self)
        help_menu = bar.addMenu("Help")
        workflow_action = QAction("Workflow guide…", self)
        workflow_action.triggered.connect(self._show_workflow_guide)
        help_menu.addAction(workflow_action)
        ai_settings = QAction("AI settings…", self)
        ai_settings.triggered.connect(self._show_ai_settings)
        help_menu.addAction(ai_settings)
        manage_printers = QAction("Manage printers…", self)
        manage_printers.triggered.connect(self._show_manage_printers)
        help_menu.addAction(manage_printers)
        help_menu.addSeparator()
        open_data = QAction("Open data folder", self)
        open_data.triggered.connect(self._open_data_folder)
        help_menu.addAction(open_data)
        open_exports = QAction("Open exports folder", self)
        open_exports.triggered.connect(self._open_exports_folder)
        help_menu.addAction(open_exports)
        help_menu.addSeparator()
        support_kofi = QAction("Support on Ko-fi…", self)
        support_kofi.triggered.connect(open_kofi)
        help_menu.addAction(support_kofi)
        help_menu.addSeparator()
        about_action = QAction("About Print Partner…", self)
        about_action.triggered.connect(self._show_about)
        help_menu.addAction(about_action)
        self.setMenuBar(bar)

    def _install_shortcuts(self) -> None:
        QShortcut(QKeySequence("Ctrl+1"), self, lambda: self._set_workflow_index(_TAB_LIBRARIES))
        QShortcut(QKeySequence("Ctrl+2"), self, lambda: self._set_workflow_index(_TAB_KIT))
        QShortcut(QKeySequence("Ctrl+3"), self, lambda: self._set_workflow_index(_TAB_PRINT))
        QShortcut(QKeySequence("Ctrl+4"), self, lambda: self._set_workflow_index(_TAB_CHECKOFF))
        QShortcut(QKeySequence("F1"), self, self._show_workflow_guide)
        QShortcut(QKeySequence("Ctrl+R"), self, self._shortcut_recompute)

    def _shortcut_recompute(self) -> None:
        if self._workflow_index != _TAB_KIT:
            return
        composer = self._profiles
        if composer is not None and self._kit_nav.currentWidget() is composer:
            composer._recompute()

    def _show_about(self) -> None:
        QMessageBox.about(
            self,
            "About Print Partner",
            f"<h3>Print Partner</h3>"
            f"<p>Version {__version__}</p>"
            f"<p>Local-first kit builder for layered STL print manifests.</p>"
            "<p>Licensed under the "
            '<a href="https://github.com/poitee/PrintPartnerPartner/blob/main/LICENSE">'
            "PolyForm Noncommercial License 1.0.0</a>. "
            "Commercial use requires permission — see COMMERCIAL.md in the app bundle "
            "or on GitHub.</p>"
            f'<p>Optional tip jar on <a href="{KOFI_URL}">Ko-fi</a>. '
            "Donations are appreciated but do not grant commercial use rights.</p>"
            "<p>Third-party notices: Help → Third-party notices…</p>",
        )

    def _show_third_party_notices(self) -> None:
        LegalNoticesDialog("THIRD_PARTY_NOTICES.md", "Third-party notices", parent=self).exec()

    def _show_license(self) -> None:
        LegalNoticesDialog("LICENSE", "License", parent=self).exec()

    def showEvent(self, event) -> None:
        super().showEvent(event)
        if self._restored_ui:
            return
        self._restored_ui = True
        self._restore_window_geometry()
        last = get_setting_value("last_tab_index", "0")
        try:
            idx = self._migrate_tab_index(int(last or "0"))
            self._set_workflow_index(idx, persist=False)
        except ValueError:
            self._set_workflow_index(_TAB_LIBRARIES, persist=False)
        self._restore_last_kit()
        maybe_show_first_run(self)
        self._refresh_workflow_strip_state()
        self._update_status_bar()

    def _restore_last_kit(self) -> None:
        raw = get_setting_value("last_profile_id")
        if not raw:
            return
        try:
            profile_id = int(raw)
        except ValueError:
            return
        composer = self._ensure_composer_in_kit_stack()
        self._show_kit_composer()
        composer.open_profile(profile_id)
        sub = get_setting_value("last_kit_submode", "compose")
        if sub in ("compose", "review"):
            composer.set_kit_sub_mode(sub)  # type: ignore[arg-type]
            self.workflow_strip.set_kit_submode(sub)

    @staticmethod
    def _migrate_tab_index(old_index: int) -> int:
        """Map saved tab index to Libraries / Kit / Print / Checkoff."""
        mapping = {
            0: _TAB_LIBRARIES,
            1: _TAB_KIT,
            2: _TAB_PRINT,
            3: _TAB_CHECKOFF,
        }
        return mapping.get(old_index, _TAB_LIBRARIES)

    def _on_workflow_step_clicked(self, index: int) -> None:
        self._set_workflow_index(index)

    def _check_checkoff_allowed(
        self,
        composer: ProfileComposer,
        *,
        use_modal: bool = False,
    ) -> bool:
        if composer._current_profile_id is None:
            return True
        if self._included_part_count(composer._current_profile_id) > 0:
            return True
        if not use_modal:
            return False
        reply = QMessageBox.question(
            self,
            "No parts chosen",
            "This kit has no included parts yet.\n\n"
            "Review the kit on the Kit tab before checkoff?",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.Yes,
        )
        if reply == QMessageBox.Yes:
            self._set_workflow_index(_TAB_KIT)
            composer.set_kit_sub_mode("review")
            self.workflow_strip.set_kit_submode("review")
            return False
        return True

    def _on_kit_submode_clicked(self, mode: str) -> None:
        composer = self._ensure_profiles()
        if self._workflow_index != _TAB_KIT:
            self._set_workflow_index(_TAB_KIT, persist=False)
        composer.set_kit_sub_mode(mode)  # type: ignore[arg-type]
        self.workflow_strip.set_kit_submode(mode)
        set_setting_value("last_kit_submode", mode)
        self._update_status_bar()

    def _on_tab_changed_workflow_strip(self, index: int) -> None:
        if self._profiles is not None and index in (_TAB_KIT, _TAB_CHECKOFF):
            if index == _TAB_KIT:
                self.workflow_strip.set_kit_submode(self._profiles.kit_sub_mode())

    def _show_ai_settings(self) -> None:
        dlg = AiSettingsDialog(self)
        if dlg.exec() and self._profiles is not None:
            self._profiles.ai_panel.refresh_enabled_state()

    def _show_manage_printers(self) -> None:
        self._set_workflow_index(_TAB_PRINT)
        self.print_tab._add_printer()

    def _go_libraries(self) -> None:
        self._set_workflow_index(_TAB_LIBRARIES)

    def _open_data_folder(self) -> None:
        settings.ensure_dirs()
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(settings.data_dir.resolve())))

    def _open_exports_folder(self) -> None:
        settings.ensure_dirs()
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(settings.exports_dir.resolve())))

    def _show_workflow_guide(self) -> None:
        dlg = WorkflowGuideDialog(self)
        dlg.exec()

    def closeEvent(self, event: QCloseEvent) -> None:
        self._persist_window_geometry()
        set_setting_value("last_tab_index", str(self._workflow_index))
        if self._profiles is not None and self._profiles._current_profile_id is not None:
            set_setting_value("last_profile_id", str(self._profiles._current_profile_id))
            set_setting_value("last_kit_submode", self._profiles.kit_sub_mode())
        self.shutdown()
        super().closeEvent(event)

    def _persist_window_geometry(self) -> None:
        geom = self.saveGeometry()
        set_setting_value("window_geometry", base64.standard_b64encode(geom.data()).decode("ascii"))

    def _restore_window_geometry(self) -> None:
        raw = get_setting_value("window_geometry")
        if not raw:
            return
        try:
            data = base64.standard_b64decode(raw.encode("ascii"))
            self.restoreGeometry(QByteArray(data))
        except (ValueError, RuntimeError):
            pass

    def set_libraries_tab_badge(self, update_count: int) -> None:
        self.workflow_strip.set_libraries_badge(update_count)

    def _status_step_label(self) -> str:
        step = _STEP_NAMES[self._workflow_index]
        composer = self._profiles
        if self._workflow_index == _TAB_KIT and composer is not None:
            sub = composer.kit_sub_mode().capitalize()
            step = f"{step} › {sub}"
        return step

    def _update_status_bar(self) -> None:
        parts = [f"Step: {self._status_step_label()}"]
        composer = self._profiles
        if composer is not None and composer._current_profile_id is not None:
            name = composer.profile_combo.currentText()
            if name:
                parts.append(f"Active: {name}")
        self._status_context.setText(" · ".join(parts))
        self._refresh_workflow_strip_state()

    def _ensure_profiles(self) -> ProfileComposer:
        if self._profiles is not None:
            return self._profiles
        self._profiles = ProfileComposer()
        self._profiles.navigate_requested.connect(self._on_composer_navigate)
        self._profiles.back_to_kit_library.connect(self._show_kit_library)
        self._profiles.profile_changed.connect(self._on_profile_changed)
        return self._profiles

    def _on_profile_changed(self) -> None:
        self._update_status_bar()
        self._sync_print_tab()

    def _ensure_composer_in_kit_stack(self) -> ProfileComposer:
        composer = self._ensure_profiles()
        if self._kit_nav.indexOf(composer) < 0:
            self._kit_nav.addWidget(composer)
        return composer

    def _show_kit_library(self) -> None:
        self._kit_nav.setCurrentIndex(0)
        self.kit_library.refresh()
        self._refresh_workflow_strip_state()
        self._update_status_bar()

    def _show_kit_composer(self) -> None:
        self._ensure_composer_in_kit_stack()
        self._kit_nav.setCurrentIndex(1)
        self._refresh_workflow_strip_state()
        self._update_status_bar()

    def _on_open_kit(self, profile_id: int) -> None:
        composer = self._ensure_composer_in_kit_stack()
        self._show_kit_composer()
        composer.open_profile(profile_id)
        self._refresh_workflow_strip_state()

    def _on_kit_list_changed(self) -> None:
        if self._profiles is not None:
            self._profiles.reload_profile_list()

    def _on_print_open_kit_library(self) -> None:
        self._set_workflow_index(_TAB_KIT)

    def _sync_print_tab(self) -> None:
        composer = self._profiles
        if composer is None or composer._current_profile_id is None:
            self.print_tab.set_kit(None, "", [])
            return
        name, _, merge_parts, _ = composer._merge_parts_for_export()
        self.print_tab.set_kit(composer._current_profile_id, name, merge_parts)

    def _on_tab_changed(self, index: int) -> None:
        if index == _TAB_LIBRARIES:
            self._content_stack.setCurrentWidget(self.source_tab)
            self.source_tab.on_libraries_shown()
            return
        if index == _TAB_PRINT:
            self._content_stack.setCurrentWidget(self.print_tab)
            self._sync_print_tab()
            return
        self._content_stack.setCurrentWidget(self._kit_host)
        if index == _TAB_KIT:
            if self._kit_nav.currentIndex() == 0:
                self.kit_library.refresh()
            elif self._profiles is not None:
                self._profiles.reload_profile_list()
                self._profiles.set_view_mode("kit", reload_parts=False)
                self._profiles.refresh_view_from_cache()
            return
        if index == _TAB_CHECKOFF:
            self._show_kit_composer()
            composer = self._ensure_profiles()
            composer.set_view_mode("checkoff", reload_parts=False)
            composer.refresh_view_from_cache()

    def _on_print_tab_export_3mf(self, options: Export3mfOptions) -> None:
        composer = self._profiles
        if composer is None or composer._current_profile_id is None:
            return
        composer.run_3mf_export(options)

    def _on_composer_navigate(self, target: str) -> None:
        if target == "libraries":
            self._set_workflow_index(_TAB_LIBRARIES)
        elif target == "print":
            self._set_workflow_index(_TAB_PRINT)
        elif target == "checkoff":
            if self._profiles and self._check_checkoff_allowed(self._profiles, use_modal=True):
                self._set_workflow_index(_TAB_CHECKOFF)
        elif target == "compose":
            self._set_workflow_index(_TAB_KIT)
            self._show_kit_composer()
            self._profiles.set_kit_sub_mode("compose", reload_parts=False)
            self._profiles.refresh_view_from_cache()
            self.workflow_strip.set_kit_submode("compose")
        elif target == "review":
            self._set_workflow_index(_TAB_KIT)
            self._show_kit_composer()
            self._profiles.set_kit_sub_mode("review", reload_parts=False)
            self._profiles.refresh_view_from_cache()
            self.workflow_strip.set_kit_submode("review")

    def _on_import_files_completed(self, project_id: int) -> None:
        composer = self._profiles
        if composer is None or self._workflow_index != _TAB_KIT:
            return
        if composer._current_profile_id is None:
            return
        with db_session() as session:
            layer_pids = [
                layer.project_id
                for layer in get_profile_layers(session, composer._current_profile_id)
            ]
            if project_id not in layer_pids:
                return
        composer.show_recompute_banner(
            "Import rules were saved. Recompute the active kit to load parts from the new files."
        )

    def shutdown(self) -> None:
        self.source_tab.shutdown()
        if self._profiles is not None:
            self._profiles.shutdown()

    def _on_projects_changed(self) -> None:
        if self._profiles is not None:
            self._profiles.reload_profile_list()
        self.kit_library.refresh()
        self.source_tab.update_libraries_tab_badge()
        self._refresh_workflow_strip_state()
