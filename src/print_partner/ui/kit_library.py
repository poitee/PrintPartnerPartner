"""All-kits list — browse, open, and manage build profiles."""

from __future__ import annotations

import json
from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QFileDialog,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QMessageBox,
    QPushButton,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from print_partner.config import settings
from print_partner.core.export_kit_bundle import (
    KIT_EXTENSION,
    export_kit_bundle,
    export_path_for_kit,
    import_kit_bundle,
)
from print_partner.core.profile_ops import delete_profile, duplicate_profile, rename_profile
from print_partner.db.session import (
    db_session,
    get_profile_layers,
    list_profiles,
    profile_part_counts,
)
from print_partner.ui.build_wizard import run_build_wizard
from print_partner.ui.empty_state import EmptyStateWidget


class KitLibraryWidget(QWidget):
    """Landing page for the Kit workflow step."""

    open_kit = Signal(int)
    list_changed = Signal()

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)

        header = QHBoxLayout()
        title = QLabel("Your kits")
        title.setProperty("emptyTitle", True)
        header.addWidget(title)
        header.addStretch(1)
        self.btn_new = QPushButton("New build…")
        self.btn_new.setObjectName("primaryButton")
        self.btn_new.clicked.connect(self._new_build)
        header.addWidget(self.btn_new)
        layout.addLayout(header)

        hint = QLabel(
            "Open a kit to compose layers, assign filament, and review parts. "
            "Use Checkoff when you are ready to print."
        )
        hint.setProperty("muted", True)
        hint.setWordWrap(True)
        layout.addWidget(hint)

        self._stack = QStackedWidget()
        self._empty = EmptyStateWidget(
            "No kits yet",
            "Create your first build profile from synced repositories on Libraries.",
            cta_text="New build…",
        )
        self._empty.cta_clicked.connect(self._new_build)
        self._stack.addWidget(self._empty)

        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(
            ["Name", "Order #", "Parts", "Included", "Layers"]
        )
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.doubleClicked.connect(self._open_selected)
        self._stack.addWidget(self.table)

        layout.addWidget(self._stack, 1)

        actions = QHBoxLayout()
        self.btn_open = QPushButton("Open kit")
        self.btn_open.setObjectName("primaryButton")
        self.btn_open.clicked.connect(self._open_selected)
        actions.addWidget(self.btn_open)
        self.btn_rename = QPushButton("Rename…")
        self.btn_rename.clicked.connect(self._rename)
        actions.addWidget(self.btn_rename)
        self.btn_duplicate = QPushButton("Duplicate…")
        self.btn_duplicate.clicked.connect(self._duplicate)
        actions.addWidget(self.btn_duplicate)
        self.btn_export = QPushButton("Export kit…")
        self.btn_export.clicked.connect(self._export_kit)
        actions.addWidget(self.btn_export)
        self.btn_import = QPushButton("Import kit…")
        self.btn_import.clicked.connect(self._import_kit)
        actions.addWidget(self.btn_import)
        self.btn_delete = QPushButton("Delete…")
        self.btn_delete.clicked.connect(self._delete)
        actions.addWidget(self.btn_delete)
        actions.addStretch(1)
        layout.addLayout(actions)

        self.refresh()

    def refresh(self) -> None:
        rows: list[dict] = []
        with db_session() as session:
            profiles = list_profiles(session)
            counts = profile_part_counts(session)
            for p in profiles:
                pid = int(p.id)
                total, included = counts.get(pid, (0, 0))
                rows.append(
                    {
                        "id": pid,
                        "name": p.name,
                        "order_number": p.order_number or "—",
                        "total": total,
                        "included": included,
                        "layers": len(get_profile_layers(session, pid)),
                    }
                )

        has_rows = bool(rows)
        self._stack.setCurrentIndex(1 if has_rows else 0)
        self.table.setRowCount(len(rows))
        for i, row in enumerate(rows):
            self.table.setItem(i, 0, QTableWidgetItem(row["name"]))
            self.table.setItem(i, 1, QTableWidgetItem(row["order_number"]))
            self.table.setItem(i, 2, QTableWidgetItem(str(row["total"])))
            self.table.setItem(i, 3, QTableWidgetItem(str(row["included"])))
            self.table.setItem(i, 4, QTableWidgetItem(str(row["layers"])))
            self.table.item(i, 0).setData(Qt.UserRole, row["id"])
        self.table.resizeColumnsToContents()

    def _selected_id(self) -> int | None:
        rows = self.table.selectionModel().selectedRows()
        if not rows:
            return None
        item = self.table.item(rows[0].row(), 0)
        return item.data(Qt.UserRole) if item else None

    def _open_selected(self) -> None:
        pid = self._selected_id()
        if pid is not None:
            self.open_kit.emit(pid)

    def _new_build(self) -> None:
        pid = run_build_wizard(parent=self)
        self.refresh()
        self.list_changed.emit()
        if pid is not None:
            self.open_kit.emit(pid)

    def _rename(self) -> None:
        pid = self._selected_id()
        if pid is None:
            QMessageBox.information(self, "Rename", "Select a kit first.")
            return
        with db_session() as session:
            from print_partner.db.models import BuildProfile

            profile = session.get(BuildProfile, pid)
            if not profile:
                return
            name, ok = QInputDialog.getText(self, "Rename kit", "Name:", text=profile.name)
            if not ok or not name.strip():
                return
            try:
                rename_profile(session, pid, name.strip())
            except ValueError as exc:
                QMessageBox.warning(self, "Rename", str(exc))
                return
        self.refresh()
        self.list_changed.emit()

    def _duplicate(self) -> None:
        pid = self._selected_id()
        if pid is None:
            QMessageBox.information(self, "Duplicate", "Select a kit first.")
            return
        with db_session() as session:
            from print_partner.db.models import BuildProfile

            profile = session.get(BuildProfile, pid)
            default = f"{profile.name} (copy)" if profile else "Copy"
        name, ok = QInputDialog.getText(self, "Duplicate kit", "New kit name:", text=default)
        if not ok or not name.strip():
            return
        with db_session() as session:
            try:
                new_id = duplicate_profile(session, pid, name.strip())
            except ValueError as exc:
                QMessageBox.warning(self, "Duplicate", str(exc))
                return
        self.refresh()
        self.list_changed.emit()
        self.open_kit.emit(new_id)

    def _export_kit(self) -> None:
        pid = self._selected_id()
        if pid is None:
            QMessageBox.information(self, "Export kit", "Select a kit first.")
            return
        with db_session() as session:
            from print_partner.db.models import BuildProfile

            profile = session.get(BuildProfile, pid)
            if not profile:
                return
            default_path = export_path_for_kit(profile.name, settings.exports_dir)
        chosen, _ = QFileDialog.getSaveFileName(
            self,
            "Export kit for sharing",
            str(default_path),
            f"Print Partner kit (*{KIT_EXTENSION})",
        )
        if not chosen:
            return
        dest = Path(chosen)
        if dest.suffix != ".zip":
            dest = dest.with_suffix(KIT_EXTENSION) if not str(dest).endswith(KIT_EXTENSION) else dest
        try:
            with db_session() as session:
                export_kit_bundle(session, pid, dest)
        except (OSError, ValueError) as exc:
            QMessageBox.critical(self, "Export kit", str(exc))
            return
        from print_partner.ui.toast import show_toast

        show_toast(
            self,
            f"Kit exported to {dest.name}. Send this file to another Print Partner user.",
        )

    def _import_kit(self) -> None:
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
            "Kit name (leave default from file if empty):",
        )
        if not ok:
            return
        new_name = name.strip() or None
        try:
            with db_session() as session:
                result = import_kit_bundle(session, Path(chosen), new_name=new_name)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            QMessageBox.critical(self, "Import kit", str(exc))
            return

        msg_parts = [
            f"Imported “{result.profile_name}” with {result.parts_imported} part(s) "
            f"and {result.layers_imported} layer(s)."
        ]
        if result.unmatched_projects:
            msg_parts.append(
                "\n\nMissing local repos (add on Libraries, then set layers):\n"
                + "\n".join(f"• {n}" for n in result.unmatched_projects[:8])
            )
        if result.warnings:
            msg_parts.append("\n\n" + "\n".join(result.warnings[:5]))
        QMessageBox.information(self, "Import kit", "".join(msg_parts))
        self.refresh()
        self.list_changed.emit()
        self.open_kit.emit(result.profile_id)

    def _delete(self) -> None:
        pid = self._selected_id()
        if pid is None:
            QMessageBox.information(self, "Delete", "Select a kit first.")
            return
        with db_session() as session:
            from print_partner.db.models import BuildProfile

            profile = session.get(BuildProfile, pid)
            if not profile:
                return
            reply = QMessageBox.question(
                self,
                "Delete kit",
                f"Delete “{profile.name}” and all its parts?",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.No,
            )
            if reply != QMessageBox.Yes:
                return
            delete_profile(session, pid)
        self.refresh()
        self.list_changed.emit()
