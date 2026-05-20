"""Application bootstrap."""

import sys

from PySide6.QtWidgets import QApplication

from print_partner.config import settings
from print_partner.db.session import init_db
from print_partner.ui.app_style import apply_app_style
from print_partner.ui.main_window import MainWindow


def run() -> int:
    settings.ensure_dirs()
    init_db()
    app = QApplication(sys.argv)
    app.setApplicationName("Print Partner")
    apply_app_style(app)

    window = MainWindow()
    app.aboutToQuit.connect(window.shutdown)
    window.statusBar().showMessage(f"Data: {settings.data_dir}")
    window.show()
    return app.exec()
