"""Main application window."""

from __future__ import annotations

import base64

from PySide6.QtCore import QByteArray, QUrl
from PySide6.QtGui import QAction, QCloseEvent, QDesktopServices, QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QMainWindow,
    QMenuBar,
    QMessageBox,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from print_partner import __version__
from print_partner.config import settings
from print_partner.db.session import (
    db_session,
    get_profile_layers,
    get_profile_parts,
    get_setting_value,
    set_setting_value,
)
from print_partner.ui.ai_settings_dialog import AiSettingsDialog
from print_partner.ui.first_run_dialog import maybe_show_first_run
from print_partner.ui.kit_library import KitLibraryWidget
from print_partner.ui.profile_composer import ProfileComposer
from print_partner.ui.tabs.source_tab import SourceTab
from print_partner.ui.workflow_strip import WorkflowStrip

_TAB_LIBRARIES = 0
_TAB_KIT = 1
_TAB_CHECKOFF = 2


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
        self._kit_nav.addWidget(self.kit_library)
        kit_layout.addWidget(self._kit_nav)
        self.kit_library.open_kit.connect(self._on_open_kit)
        self.kit_library.list_changed.connect(self._on_kit_list_changed)

        self._content_stack.addWidget(self.source_tab)
        self._content_stack.addWidget(self._kit_host)

        self._profiles: ProfileComposer | None = None
        self.workflow_strip.step_clicked.connect(self._on_workflow_step_clicked)
        self.workflow_strip.kit_submode_clicked.connect(self._on_kit_submode_clicked)
        self.source_tab.projects_changed.connect(self._on_projects_changed)

        central = QWidget()
        central_layout = QVBoxLayout(central)
        central_layout.setContentsMargins(0, 0, 0, 0)
        central_layout.setSpacing(0)
        central_layout.addWidget(self.workflow_strip)
        central_layout.addWidget(self._content_stack, 1)
        self.setCentralWidget(central)
        self._install_menu_bar()
        self._install_shortcuts()

    @property
    def workflow_index(self) -> int:
        return self._workflow_index

    def _set_workflow_index(self, index: int, *, persist: bool = True) -> None:
        if index < 0 or index > _TAB_CHECKOFF:
            return
        self._workflow_index = index
        self.workflow_strip.set_current_step(index)
        self._on_tab_changed(index)
        self._on_tab_changed_workflow_strip(index)
        if persist:
            set_setting_value("last_tab_index", str(index))

    def _install_menu_bar(self) -> None:
        bar = QMenuBar(self)
        help_menu = bar.addMenu("Help")
        workflow_action = QAction("Workflow guide…", self)
        workflow_action.triggered.connect(self._show_workflow_guide)
        help_menu.addAction(workflow_action)
        ai_settings = QAction("AI settings…", self)
        ai_settings.triggered.connect(self._show_ai_settings)
        help_menu.addAction(ai_settings)
        help_menu.addSeparator()
        open_data = QAction("Open data folder", self)
        open_data.triggered.connect(self._open_data_folder)
        help_menu.addAction(open_data)
        open_exports = QAction("Open exports folder", self)
        open_exports.triggered.connect(self._open_exports_folder)
        help_menu.addAction(open_exports)
        help_menu.addSeparator()
        about_action = QAction("About Print Partner…", self)
        about_action.triggered.connect(self._show_about)
        help_menu.addAction(about_action)
        self.setMenuBar(bar)

    def _install_shortcuts(self) -> None:
        QShortcut(QKeySequence("Ctrl+1"), self, lambda: self._set_workflow_index(_TAB_LIBRARIES))
        QShortcut(QKeySequence("Ctrl+2"), self, lambda: self._set_workflow_index(_TAB_KIT))
        QShortcut(QKeySequence("Ctrl+3"), self, lambda: self._set_workflow_index(_TAB_CHECKOFF))
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
            f"<p>Local-first kit builder for layered STL print manifests.</p>",
        )

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
        maybe_show_first_run(self)
        self._update_status_bar()

    @staticmethod
    def _migrate_tab_index(old_index: int) -> int:
        """Map legacy 4-tab indices (Source, Build, Verify, Checkoff) to 3-tab layout."""
        if old_index <= 0:
            return _TAB_LIBRARIES
        if old_index <= 2:
            return _TAB_KIT
        return _TAB_CHECKOFF

    def _on_workflow_step_clicked(self, index: int) -> None:
        if index == _TAB_CHECKOFF:
            composer = self._profiles
            if composer is not None and not self._check_checkoff_allowed(composer):
                return
        self._set_workflow_index(index)

    def _check_checkoff_allowed(self, composer: ProfileComposer) -> bool:
        if composer._current_profile_id is None:
            return True
        with db_session() as session:
            parts = get_profile_parts(session, composer._current_profile_id)
            included = sum(1 for p in parts if p.included)
        if included > 0:
            return True
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

    def _on_tab_changed_workflow_strip(self, index: int) -> None:
        if index == _TAB_KIT and self._profiles is not None:
            self.workflow_strip.set_kit_submode(self._profiles.kit_sub_mode())

    def _show_ai_settings(self) -> None:
        dlg = AiSettingsDialog(self)
        if dlg.exec() and self._profiles is not None:
            self._profiles.ai_panel.refresh_enabled_state()

    def _open_data_folder(self) -> None:
        settings.ensure_dirs()
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(settings.data_dir.resolve())))

    def _open_exports_folder(self) -> None:
        settings.ensure_dirs()
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(settings.exports_dir.resolve())))

    def _show_workflow_guide(self) -> None:
        QMessageBox.information(
            self,
            "Workflow",
            "<h3>Libraries → Kit → Checkoff</h3>"
            "<p><b>Libraries</b> — Add/sync repos and import which STL files to use.</p>"
            "<p><b>Kit</b> — <b>Compose</b>: layers, filament, parts tree. "
            "<b>Review</b>: confirm included parts before printing.</p>"
            "<p><b>Checkoff</b> — Printable checklist, print progress, export HTML/STLs.</p>"
            "<p>Use the workflow strip to jump between steps; on Kit, choose Compose or Review on the right.</p>",
        )

    def closeEvent(self, event: QCloseEvent) -> None:
        self._persist_window_geometry()
        set_setting_value("last_tab_index", str(self._workflow_index))
        if self._profiles is not None and self._profiles._current_profile_id is not None:
            set_setting_value("last_profile_id", str(self._profiles._current_profile_id))
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

    def _update_status_bar(self) -> None:
        settings.ensure_dirs()
        msg = f"Data: {settings.data_dir}"
        composer = self._profiles
        if composer is not None and composer._current_profile_id is not None:
            name = composer.profile_combo.currentText()
            if name:
                msg += f"  |  Active kit: {name}"
        self.statusBar().showMessage(msg)

    def _ensure_profiles(self) -> ProfileComposer:
        if self._profiles is not None:
            return self._profiles
        self._profiles = ProfileComposer()
        self._profiles.navigate_requested.connect(self._on_composer_navigate)
        self._profiles.back_to_kit_library.connect(self._show_kit_library)
        self._profiles.profile_changed.connect(self._update_status_bar)
        return self._profiles

    def _ensure_composer_in_kit_stack(self) -> ProfileComposer:
        composer = self._ensure_profiles()
        if self._kit_nav.indexOf(composer) < 0:
            self._kit_nav.addWidget(composer)
        return composer

    def _show_kit_library(self) -> None:
        self._kit_nav.setCurrentIndex(0)
        self.kit_library.refresh()
        self._update_status_bar()

    def _show_kit_composer(self) -> None:
        self._ensure_composer_in_kit_stack()
        self._kit_nav.setCurrentIndex(1)
        self._update_status_bar()

    def _on_open_kit(self, profile_id: int) -> None:
        composer = self._ensure_composer_in_kit_stack()
        self._show_kit_composer()
        composer.open_profile(profile_id)

    def _on_kit_list_changed(self) -> None:
        if self._profiles is not None:
            self._profiles.reload_profile_list()

    def _on_tab_changed(self, index: int) -> None:
        if index == _TAB_LIBRARIES:
            self._content_stack.setCurrentWidget(self.source_tab)
            self.source_tab.on_libraries_shown()
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
            composer = self._profiles
            if composer is not None and not self._check_checkoff_allowed(composer):
                self._set_workflow_index(_TAB_KIT, persist=False)
                return
            self._show_kit_composer()
            composer = self._ensure_profiles()
            composer.set_view_mode("checkoff", reload_parts=False)
            composer.refresh_view_from_cache()

    def _on_composer_navigate(self, target: str) -> None:
        if target == "libraries":
            self._set_workflow_index(_TAB_LIBRARIES)
        elif target == "checkoff":
            if self._profiles and self._check_checkoff_allowed(self._profiles):
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
