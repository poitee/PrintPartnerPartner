"""Application bootstrap."""

import sys

from PySide6.QtWidgets import QApplication

from print_partner.config import settings
from print_partner.db.session import init_db
from print_partner.ui.main_window import MainWindow


def run() -> int:
    from print_partner.debug_trace import debug_log

    settings.ensure_dirs()
    init_db()
    app = QApplication(sys.argv)
    app.setApplicationName("Print Partner")

    window = MainWindow()

    def _on_about_to_quit() -> None:
        # region agent log
        debug_log("app.run", "aboutToQuit", {}, hypothesis_id="A", run_id="post-fix")
        # endregion
        window.shutdown()
        # region agent log
        debug_log("app.run", "aboutToQuit_shutdown_done", {}, hypothesis_id="A", run_id="post-fix")
        # endregion

    app.aboutToQuit.connect(_on_about_to_quit)
    window.statusBar().showMessage(f"Data: {settings.data_dir}")
    window.show()
    # region agent log
    debug_log("app.run", "exec_start", {}, hypothesis_id="D")
    # endregion
    code = app.exec()
    # region agent log
    debug_log("app.run", "exec_end", {"code": code}, hypothesis_id="D")
    # endregion
    return code
