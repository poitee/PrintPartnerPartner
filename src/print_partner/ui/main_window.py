"""Main application window."""

from PySide6.QtGui import QCloseEvent
from PySide6.QtWidgets import QMainWindow, QTabWidget, QWidget

from print_partner.db.session import get_setting_value, set_setting_value
from print_partner.ui.profile_composer import ProfileComposer
from print_partner.ui.project_library import ProjectLibrary


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Print Partner")
        self.resize(1200, 800)
        self._restored_tab = False

        self.tabs = QTabWidget()
        self.projects = ProjectLibrary()
        self._profiles: ProfileComposer | None = None
        self._profiles_placeholder = QWidget()
        self.tabs.addTab(self.projects, "Projects")
        self.tabs.addTab(self._profiles_placeholder, "Profiles")
        self.tabs.currentChanged.connect(self._on_tab_changed)
        self.tabs.currentChanged.connect(self._save_tab_index)
        self.projects.projects_changed.connect(self._on_projects_changed)
        self.setCentralWidget(self.tabs)

    def showEvent(self, event) -> None:
        super().showEvent(event)
        if self._restored_tab:
            return
        self._restored_tab = True
        last = get_setting_value("last_tab_index", "0")
        try:
            idx = int(last or "0")
            if 0 <= idx < self.tabs.count():
                self.tabs.setCurrentIndex(idx)
        except ValueError:
            pass

    def closeEvent(self, event: QCloseEvent) -> None:
        from print_partner.debug_trace import debug_log

        thumb_running = False
        sync_running = False
        if self._profiles is not None:
            w = self._profiles._thumb_worker
            thumb_running = w is not None and w.isRunning()
        sync_w = getattr(self.projects, "_sync_worker", None)
        sync_running = sync_w is not None and sync_w.isRunning()
        # region agent log
        debug_log(
            "main_window.closeEvent",
            "window_closing",
            {
                "thumb_running": thumb_running,
                "sync_running": sync_running,
                "has_profiles": self._profiles is not None,
            },
            hypothesis_id="A",
        )
        # endregion
        self.shutdown()
        self._save_tab_index(self.tabs.currentIndex())
        if self._profiles is not None and self._profiles._current_profile_id is not None:
            set_setting_value("last_profile_id", str(self._profiles._current_profile_id))
        super().closeEvent(event)
        # region agent log
        debug_log("main_window.closeEvent", "after_super_closeEvent", {}, hypothesis_id="A")
        # endregion

    def _save_tab_index(self, index: int) -> None:
        if index >= 0:
            set_setting_value("last_tab_index", str(index))

    def _ensure_profiles(self) -> ProfileComposer:
        if self._profiles is not None:
            return self._profiles
        self._profiles = ProfileComposer()
        idx = self.tabs.indexOf(self._profiles_placeholder)
        self.tabs.removeTab(idx)
        self.tabs.insertTab(idx, self._profiles, "Profiles")
        return self._profiles

    def _on_tab_changed(self, index: int) -> None:
        widget = self.tabs.widget(index)
        if widget is self._profiles_placeholder:
            profiles = self._ensure_profiles()
            self.tabs.setCurrentWidget(profiles)

    def shutdown(self) -> None:
        """Stop background threads before Qt tears down widgets."""
        self.projects.shutdown()
        if self._profiles is not None:
            self._profiles.shutdown()

    def _on_projects_changed(self) -> None:
        if self._profiles is not None:
            self._profiles.refresh_profiles()
