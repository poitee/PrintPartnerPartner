"""STL preview via subprocess offscreen render + QLabel (stable on macOS)."""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

from PySide6.QtCore import QProcess, Qt, QTimer
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QPushButton, QScrollArea, QVBoxLayout


class StlViewer(QFrame):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("StlViewer")
        self.setMinimumHeight(280)
        self.setFrameShape(QFrame.StyledPanel)

        root = QVBoxLayout(self)
        root.setContentsMargins(4, 4, 4, 4)

        header = QHBoxLayout()
        self._title = QLabel("3D preview")
        self._title.setProperty("emptyTitle", True)
        header.addWidget(self._title, 1)
        self._btn_reset = QPushButton("Refresh view")
        self._btn_reset.clicked.connect(self._refresh_view)
        header.addWidget(self._btn_reset)
        root.addLayout(header)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setAlignment(Qt.AlignCenter)
        self._image = QLabel("Select a part in the table to preview its STL.")
        self._image.setAlignment(Qt.AlignCenter)
        self._image.setWordWrap(True)
        self._image.setMinimumSize(320, 240)
        scroll.setWidget(self._image)
        root.addWidget(scroll, 1)

        self._pending_path: Path | None = None
        self._pending_role: str | None = "primary"
        self._pending_mesh_hex: str | None = None
        self._png_path: Path | None = None
        self._process: QProcess | None = None
        self._temp_dir = Path(tempfile.mkdtemp(prefix="print_partner_preview_"))
        self._render_generation = 0
        self._load_timer = QTimer(self)
        self._load_timer.setSingleShot(True)
        self._load_timer.timeout.connect(self._start_render)

    def _refresh_view(self) -> None:
        if self._pending_path and self._pending_path.is_file():
            self.load_stl(
                self._pending_path,
                self._pending_role,
                mesh_hex=self._pending_mesh_hex,
            )

    def load_stl(
        self,
        path: Path | None,
        role: str | None = None,
        mesh_hex: str | None = None,
    ) -> None:
        self._pending_path = path
        self._pending_role = role or "primary"
        self._pending_mesh_hex = mesh_hex
        self._load_timer.start(120)

    def _stop_process(self) -> None:
        if self._process and self._process.state() != QProcess.NotRunning:
            self._process.kill()
            self._process.waitForFinished(2000)
        self._process = None

    def _start_render(self) -> None:
        from print_partner.core.mesh_color import normalize_mesh_hex

        path = self._pending_path
        role = self._pending_role or "primary"
        mesh_hex = normalize_mesh_hex(self._pending_mesh_hex)
        self._stop_process()

        if path is None or not path.is_file():
            self._title.setText("3D preview")
            self._image.setText("Select a part in the table to preview its STL.")
            self._image.setPixmap(QPixmap())
            return

        self._title.setText(f"3D preview — {path.name}")
        self._image.setText(f"Rendering {path.name}…")
        self._image.setPixmap(QPixmap())

        safe = path.name.replace("/", "_").replace(" ", "_")[:80]
        color_key = (mesh_hex or role).lstrip("#").replace("/", "_")[:24]
        # v2: solid mesh preview (no PyVista wireframe edges)
        self._png_path = self._temp_dir / f"{safe}_{color_key}_solidv2.png"
        self._render_generation += 1
        generation = self._render_generation

        self._process = QProcess(self)
        self._process.finished.connect(
            lambda code, status, gen=generation: self._on_process_finished(code, status, gen)
        )
        cmd = [
            "-m",
            "print_partner.preview_cli",
            str(path.resolve()),
            str(self._png_path.resolve()),
            role,
        ]
        if mesh_hex:
            cmd.append(mesh_hex)
        self._process.start(sys.executable, cmd)

    def _on_process_finished(
        self, exit_code: int, status: QProcess.ExitStatus, generation: int
    ) -> None:
        try:
            self._handle_process_finished(exit_code, status, generation)
        except Exception as exc:
            name = self._pending_path.name if self._pending_path else "part"
            self._image.setPixmap(QPixmap())
            self._image.setText(f"Preview error for {name}:\n{exc}")

    def _handle_process_finished(
        self, exit_code: int, status: QProcess.ExitStatus, generation: int
    ) -> None:
        if generation != self._render_generation:
            return
        path = self._pending_path
        png = self._png_path
        if exit_code != 0 or png is None or not png.is_file():
            name = path.name if path else "part"
            self._image.setPixmap(QPixmap())
            err = ""
            if self._process:
                err = bytes(self._process.readAllStandardError()).decode("utf-8", errors="replace").strip()
            self._image.setText(f"Could not preview {name}:\n{err or 'render failed'}")
            return

        pix = QPixmap(str(png))
        if pix.isNull():
            self._image.setText("Could not load preview image.")
            return
        w = max(self._image.width(), 320)
        h = max(self._image.height(), 240)
        self._image.setText("")
        self._image.setPixmap(pix.scaled(w, h, Qt.KeepAspectRatio, Qt.SmoothTransformation))

    def shutdown(self) -> None:
        self._load_timer.stop()
        self._stop_process()
        if self._temp_dir.is_dir():
            shutil.rmtree(self._temp_dir, ignore_errors=True)

    def clear(self) -> None:
        self._stop_process()
        self._pending_path = None
        self._title.setText("3D preview")
        self._image.setText("Select a part in the table to preview its STL.")
        self._image.setPixmap(QPixmap())
