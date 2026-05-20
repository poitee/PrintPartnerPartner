"""Main application window."""

from __future__ import annotations

import base64
from typing import Literal

from PySide6.QtCore import QByteArray
from PySide6.QtGui import QAction, QCloseEvent
from PySide6.QtWidgets import QMainWindow, QMenuBar, QMessageBox, QTabWidget, QVBoxLayout, QWidget

from print_partner import __version__
from print_partner.db.session import get_setting_value, set_setting_value
from print_partner.ui.profile_composer import ProfileComposer
from print_partner.ui.tabs.source_tab import SourceTab

KitViewMode = Literal["build", "verify", "checkoff"]
_KIT_TAB_MODES: dict[int, KitViewMode] = {1: "build", 2: "verify", 3: "checkoff"}


class TabHost(QWidget):
    """Empty host; ProfileComposer is reparented here for Build / Verify / Checkoff."""


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Print Partner")
        self.resize(1200, 800)
        self._restored_ui = False

        self.tabs = QTabWidget()
        self.source_tab = SourceTab()
        self._kit_hosts: dict[int, TabHost] = {}
        for idx, label in enumerate(("Build", "Verify", "Checkoff"), start=1):
            host = TabHost()
            QVBoxLayout(host).setContentsMargins(0, 0, 0, 0)
            self._kit_hosts[idx] = host
            self.tabs.addTab(host, label)
        self.tabs.insertTab(0, self.source_tab, "Source")

        self._profiles: ProfileComposer | None = None
        self.tabs.currentChanged.connect(self._on_tab_changed)
        self.tabs.currentChanged.connect(self._save_tab_index)
        self.source_tab.projects_changed.connect(self._on_projects_changed)
        self.setCentralWidget(self.tabs)
        self._install_menu_bar()

    def _install_menu_bar(self) -> None:
        bar = QMenuBar(self)
        help_menu = bar.addMenu("Help")
        about_action = QAction("About Print Partner…", self)
        about_action.triggered.connect(self._show_about)
        help_menu.addAction(about_action)
        self.setMenuBar(bar)

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
            idx = int(last or "0")
            if 0 <= idx < self.tabs.count():
                self.tabs.setCurrentIndex(idx)
        except ValueError:
            pass
        self._on_tab_changed(self.tabs.currentIndex())

    def closeEvent(self, event: QCloseEvent) -> None:
        self._persist_window_geometry()
        self._save_tab_index(self.tabs.currentIndex())
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

    def _save_tab_index(self, index: int) -> None:
        if index >= 0:
            set_setting_value("last_tab_index", str(index))

    def _ensure_profiles(self) -> ProfileComposer:
        if self._profiles is not None:
            return self._profiles
        self._profiles = ProfileComposer()
        return self._profiles

    def _detach_composer(self) -> None:
        if self._profiles is None:
            return
        parent = self._profiles.parentWidget()
        if parent is not None and parent.layout() is not None:
            parent.layout().removeWidget(self._profiles)

    def _attach_composer_to_tab(self, tab_index: int) -> None:
        mode = _KIT_TAB_MODES.get(tab_index)
        if mode is None:
            return
        composer = self._ensure_profiles()
        host = self._kit_hosts[tab_index]
        if composer.parentWidget() is not host:
            self._detach_composer()
            host.layout().addWidget(composer)
        composer.set_view_mode(mode)

    def _on_tab_changed(self, index: int) -> None:
        if index == 0:
            self._detach_composer()
            return
        self._attach_composer_to_tab(index)

    def shutdown(self) -> None:
        """Stop background threads before Qt tears down widgets."""
        self.source_tab.shutdown()
        if self._profiles is not None:
            self._profiles.shutdown()

    def _on_projects_changed(self) -> None:
        if self._profiles is not None:
            self._profiles.refresh_profiles()
