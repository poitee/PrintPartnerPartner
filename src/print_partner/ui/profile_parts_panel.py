"""Profile parts curation panel (folder sections, filters, print progress)."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QCheckBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from print_partner.core.parts_grouping import (
    folder_key_from_relative_path,
    folder_scan_order,
    order_folders,
)
from print_partner.core.profile_parts_adapter import display_dict_to_scanned, filter_profile_dicts
from print_partner.ui.folder_section_widget import FolderSectionWidget


class ProfilePartsPanel(QWidget):
    part_selected = Signal(int)
    visible_part_ids_changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._all_rows: list[dict] = []
        self._display_rows: list[dict] = []
        self._included_part_ids: set[int] = set()
        self._scan_order: dict[str, int] = {}
        self._folder_scan_order: list[str] = []
        self._pinned_folders: list[str] = []
        self._section_widgets: dict[str, FolderSectionWidget] = {}
        self._hide_printed = False
        self._on_inclusion_changed = None
        self._on_print_toggle = None

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)

        hint = QLabel("Curate parts for this profile. Click Printed to mark units.")
        hint.setStyleSheet("color: #555;")
        root.addWidget(hint)

        toolbar = QHBoxLayout()
        self.filter_edit = QLineEdit()
        self.filter_edit.setPlaceholderText("Filter parts…")
        self.filter_edit.setClearButtonEnabled(True)
        self.filter_edit.textChanged.connect(self._on_filter_changed)
        toolbar.addWidget(self.filter_edit, 1)
        self.sort_check = QCheckBox("Sort by name")
        self.sort_check.setChecked(True)
        self.sort_check.toggled.connect(self._rebuild_ui)
        toolbar.addWidget(self.sort_check)
        self.hide_printed_check = QCheckBox("Hide fully printed")
        self.hide_printed_check.toggled.connect(self._on_hide_printed)
        toolbar.addWidget(self.hide_printed_check)
        root.addLayout(toolbar)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.sections_host = QWidget()
        self.sections_layout = QVBoxLayout(self.sections_host)
        self.sections_layout.addStretch()
        self.scroll.setWidget(self.sections_host)
        root.addWidget(self.scroll, 1)

        buttons = QHBoxLayout()
        self.btn_include = QPushButton("Include selected")
        self.btn_include.clicked.connect(lambda: self._set_selected_visible(True))
        self.btn_exclude = QPushButton("Exclude selected")
        self.btn_exclude.clicked.connect(lambda: self._set_selected_visible(False))
        self.btn_all = QPushButton("Include all")
        self.btn_all.clicked.connect(self._include_all)
        self.btn_none = QPushButton("Exclude all")
        self.btn_none.clicked.connect(self._exclude_all)
        buttons.addWidget(self.btn_include)
        buttons.addWidget(self.btn_exclude)
        buttons.addWidget(self.btn_all)
        buttons.addWidget(self.btn_none)
        root.addLayout(buttons)

        self.summary = QLabel("")
        self.summary.setStyleSheet("color: #555;")
        root.addWidget(self.summary)

    def set_callbacks(
        self,
        on_inclusion_changed,
        on_print_toggle,
    ) -> None:
        self._on_inclusion_changed = on_inclusion_changed
        self._on_print_toggle = on_print_toggle

    def load_parts(self, all_rows: list[dict], display_rows: list[dict]) -> None:
        """Load snapshots only — never pass detached ORM Part instances."""
        self._all_rows = list(all_rows)
        self._display_rows = list(display_rows)
        self._included_part_ids = {r["id"] for r in all_rows if r["included"]}
        scanned = [display_dict_to_scanned(r) for r in all_rows]
        self._scan_order = {s.match_key: i for i, s in enumerate(scanned)}
        self._folder_scan_order = folder_scan_order(scanned)
        self._rebuild_ui()

    def visible_part_ids(self) -> set[int]:
        return self._visible_part_ids()

    def _visible_part_ids(self) -> set[int]:
        visible = self._visible_rows()
        return {r["id"] for r in visible}

    def _visible_rows(self) -> list[dict]:
        text_filtered = filter_profile_dicts(self._all_rows, self.filter_edit.text())
        text_ids = {r["id"] for r in text_filtered}
        result: list[dict] = []
        for d in self._display_rows:
            if d["id"] not in text_ids:
                continue
            if self._hide_printed:
                qty = max(1, d.get("quantity_effective", 1))
                if d.get("printed_count", 0) >= qty:
                    continue
            result.append(d)
        return result

    def _on_hide_printed(self) -> None:
        self._hide_printed = self.hide_printed_check.isChecked()
        self._rebuild_ui()

    def _on_filter_changed(self) -> None:
        self._update_bulk_button_labels()
        self._rebuild_ui()
        self.visible_part_ids_changed.emit()

    def _update_bulk_button_labels(self) -> None:
        if self.filter_edit.text().strip():
            self.btn_all.setText("Include all shown")
            self.btn_none.setText("Exclude all shown")
        else:
            self.btn_all.setText("Include all")
            self.btn_none.setText("Exclude all")

    def _rebuild_ui(self) -> None:
        while self.sections_layout.count() > 1:
            item = self.sections_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        self._section_widgets.clear()

        visible = self._visible_rows()
        grouped: dict[str, list[dict]] = {}
        for row in visible:
            folder = folder_key_from_relative_path(row["relative_path"])
            grouped.setdefault(folder, []).append(row)

        folder_keys = order_folders(
            list(grouped.keys()),
            sort_by_name=self.sort_check.isChecked(),
            pinned_folders=self._pinned_folders,
            scan_order=self._folder_scan_order,
        )

        for folder in folder_keys:
            folder_rows = grouped.get(folder, [])
            scan_order = self._scan_order
            folder_rows.sort(
                key=lambda r: (
                    r["filename"].lower()
                    if self.sort_check.isChecked()
                    else scan_order.get(r["match_key"], 9999)
                )
            )
            section = FolderSectionWidget(folder, table_mode="profile")
            section.set_pinned(folder in self._pinned_folders)
            section.load_profile_parts(folder_rows, self._included_part_ids)
            section.pin_toggled.connect(self._on_pin_toggled)
            section.inclusion_changed.connect(self._on_section_inclusion_changed)
            section.printed_unit_toggled.connect(self._on_printed_unit)
            section.table.itemSelectionChanged.connect(self._on_section_selection)
            self._section_widgets[folder] = section
            self.sections_layout.insertWidget(self.sections_layout.count() - 1, section)

        total = len(self._all_rows)
        inc_count = sum(1 for r in self._all_rows if r["id"] in self._included_part_ids)
        showing = len(visible)
        text = f"{inc_count} of {total} parts included for printing"
        if showing != total:
            text += f" · showing {showing} of {total} parts"
        self.summary.setText(text)
        self._update_bulk_button_labels()
        self.visible_part_ids_changed.emit()

    def _on_section_selection(self) -> None:
        for section in self._section_widgets.values():
            ids = section.selected_part_ids()
            if ids:
                self.part_selected.emit(ids[0])
                return

    def _on_printed_unit(self, part_id: int, unit_index: int) -> None:
        if self._on_print_toggle:
            self._on_print_toggle(part_id, unit_index)

    def _on_pin_toggled(self, folder: str, pinned: bool) -> None:
        if pinned and folder not in self._pinned_folders:
            self._pinned_folders.append(folder)
        elif not pinned and folder in self._pinned_folders:
            self._pinned_folders.remove(folder)
        self._rebuild_ui()

    def _on_section_inclusion_changed(self) -> None:
        for section in self._section_widgets.values():
            for row in section._profile_rows:
                if row["id"] in section._included_part_ids:
                    self._included_part_ids.add(row["id"])
                else:
                    self._included_part_ids.discard(row["id"])
        if self._on_inclusion_changed:
            self._on_inclusion_changed(self._included_part_ids)

    def _set_selected_visible(self, included: bool) -> None:
        ids: list[int] = []
        for section in self._section_widgets.values():
            ids.extend(section.selected_part_ids())
        if not ids:
            QMessageBox.information(self, "Selection", "Select one or more parts in the tables.")
            return
        for pid in ids:
            if included:
                self._included_part_ids.add(pid)
            else:
                self._included_part_ids.discard(pid)
        if self._on_inclusion_changed:
            self._on_inclusion_changed(self._included_part_ids)
        self._rebuild_ui()

    def _include_all(self) -> None:
        visible_ids = {r["id"] for r in self._visible_rows()}
        self._included_part_ids.update(visible_ids)
        if self._on_inclusion_changed:
            self._on_inclusion_changed(self._included_part_ids)
        self._rebuild_ui()

    def _exclude_all(self) -> None:
        visible_ids = {r["id"] for r in self._visible_rows()}
        self._included_part_ids.difference_update(visible_ids)
        if self._on_inclusion_changed:
            self._on_inclusion_changed(self._included_part_ids)
        self._rebuild_ui()

    def refresh_display_rows(self, display_rows: list[dict]) -> None:
        """Update printed counts without full part reload."""
        self._display_rows = list(display_rows)
        self._rebuild_ui()
