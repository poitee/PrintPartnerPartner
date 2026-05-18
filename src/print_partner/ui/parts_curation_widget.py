"""Reusable parts curation with folder sections, filter, and suggestions."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from print_partner.core.parts_grouping import (
    apply_bulk_exclude,
    apply_bulk_include,
    filter_parts,
    folder_scan_order,
    group_by_folder,
    match_keys_for_parts,
    order_folders,
    sort_parts,
)
from print_partner.core.parts_suggestions import DEFAULT_FUZZY_THRESHOLD, Suggestion, build_suggestions
from print_partner.core.readme_hints import ReadmeHint, hints_from_repo
from print_partner.core.scanner import ScannedPart
from print_partner.ui.folder_section_widget import FolderSectionWidget


class PartsCurationWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._parts: list[ScannedPart] = []
        self._included: set[str] = set()
        self._scan_order: dict[str, int] = {}
        self._folder_scan_order: list[str] = []
        self._pinned_folders: list[str] = []
        self._reference_layers: list[tuple[str, list[ScannedPart], set[str]]] | None = None
        self._readme_hints: list[ReadmeHint] = []
        self._suggestions: list[Suggestion] = []
        self._suggestions_dismissed = False
        self._section_widgets: dict[str, FolderSectionWidget] = {}

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)

        hint = QLabel("Select parts to print. Shift/Cmd+click for multiple rows.")
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
        root.addLayout(toolbar)

        self.suggestions_box = QGroupBox("Suggestions")
        self.suggestions_box.setCheckable(True)
        self.suggestions_box.setChecked(True)
        sug_layout = QVBoxLayout(self.suggestions_box)
        thresh_row = QHBoxLayout()
        thresh_row.addWidget(QLabel("Fuzzy threshold:"))
        self.fuzzy_threshold = QSpinBox()
        self.fuzzy_threshold.setRange(70, 95)
        self.fuzzy_threshold.setValue(DEFAULT_FUZZY_THRESHOLD)
        self.fuzzy_threshold.valueChanged.connect(self._rebuild_suggestions)
        thresh_row.addWidget(self.fuzzy_threshold)
        thresh_row.addStretch()
        sug_layout.addLayout(thresh_row)
        self.suggestions_table = QTableWidget(0, 5)
        self.suggestions_table.setHorizontalHeaderLabels(
            ["Source", "Action", "Part", "Because", ""]
        )
        self.suggestions_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.suggestions_table.setMaximumHeight(140)
        sug_layout.addWidget(self.suggestions_table)
        sug_btns = QHBoxLayout()
        self.btn_apply_inc = QPushButton("Apply all include")
        self.btn_apply_inc.clicked.connect(lambda: self._apply_suggestions("include"))
        self.btn_apply_exc = QPushButton("Apply all exclude")
        self.btn_apply_exc.clicked.connect(lambda: self._apply_suggestions("exclude"))
        self.btn_dismiss_sug = QPushButton("Dismiss")
        self.btn_dismiss_sug.clicked.connect(self._dismiss_suggestions)
        sug_btns.addWidget(self.btn_apply_inc)
        sug_btns.addWidget(self.btn_apply_exc)
        sug_btns.addWidget(self.btn_dismiss_sug)
        sug_layout.addLayout(sug_btns)
        root.addWidget(self.suggestions_box)

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

    def load_parts(
        self,
        parts: list[ScannedPart],
        included: set[str] | None = None,
        reference_layers: list[tuple[str, list[ScannedPart], set[str]]] | None = None,
        repo_path: Path | None = None,
        extra_readme_paths: list[Path] | None = None,
    ) -> None:
        self._parts = list(parts)
        self._scan_order = {p.match_key: i for i, p in enumerate(parts)}
        self._folder_scan_order = folder_scan_order(parts)
        if included is None:
            self._included = {p.match_key for p in parts}
        else:
            self._included = set(included)
        self._reference_layers = reference_layers
        self._suggestions_dismissed = False

        self._readme_hints = []
        if repo_path:
            self._readme_hints.extend(hints_from_repo(repo_path, parts))
        for path in extra_readme_paths or []:
            self._readme_hints.extend(hints_from_repo(path, parts))

        self._rebuild_suggestions()
        self._rebuild_ui()

    def included_match_keys(self) -> set[str]:
        return set(self._included)

    def _rebuild_suggestions(self) -> None:
        if self._suggestions_dismissed:
            self._suggestions = []
        else:
            self._suggestions = build_suggestions(
                self._parts,
                self._included,
                reference_layers=self._reference_layers,
                readme_hints=self._readme_hints or None,
                fuzzy_threshold=float(self.fuzzy_threshold.value()),
            )
        has_suggestions = bool(self._suggestions)
        self.suggestions_box.setVisible(has_suggestions or bool(self._reference_layers) or bool(self._readme_hints))
        self.suggestions_table.setRowCount(len(self._suggestions))
        for i, sug in enumerate(self._suggestions):
            part = next((p for p in self._parts if p.match_key == sug.target_match_key), None)
            name = part.filename if part else sug.target_match_key
            self.suggestions_table.setItem(i, 0, QTableWidgetItem(sug.source))
            self.suggestions_table.setItem(i, 1, QTableWidgetItem(sug.action))
            self.suggestions_table.setItem(i, 2, QTableWidgetItem(name))
            item = QTableWidgetItem(sug.reason)
            item.setToolTip(sug.reason)
            self.suggestions_table.setItem(i, 3, item)
            btn = QPushButton("Apply")
            btn.clicked.connect(lambda checked=False, s=sug: self._apply_one(s))
            self.suggestions_table.setCellWidget(i, 4, btn)

    def _apply_one(self, sug: Suggestion) -> None:
        if sug.action == "include":
            self._included.add(sug.target_match_key)
        else:
            self._included.discard(sug.target_match_key)
        self._rebuild_suggestions()
        self._rebuild_ui()

    def _apply_suggestions(self, action: str) -> None:
        visible_keys = self._visible_match_keys()
        for sug in self._suggestions:
            if sug.action != action:
                continue
            if sug.target_match_key not in visible_keys:
                continue
            if action == "include":
                self._included.add(sug.target_match_key)
            else:
                self._included.discard(sug.target_match_key)
        self._rebuild_suggestions()
        self._rebuild_ui()

    def _dismiss_suggestions(self) -> None:
        self._suggestions_dismissed = True
        self._rebuild_suggestions()

    def _visible_parts(self) -> list[ScannedPart]:
        return filter_parts(self._parts, self.filter_edit.text())

    def _visible_match_keys(self) -> set[str]:
        return match_keys_for_parts(self._visible_parts())

    def _on_filter_changed(self) -> None:
        self._update_bulk_button_labels()
        self._rebuild_ui()

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

        visible = self._visible_parts()
        grouped = group_by_folder(visible)
        folder_keys = order_folders(
            list(grouped.keys()),
            sort_by_name=self.sort_check.isChecked(),
            pinned_folders=self._pinned_folders,
            scan_order=self._folder_scan_order,
        )

        for folder in folder_keys:
            folder_parts = grouped.get(folder, [])
            sorted_parts = sort_parts(
                folder_parts,
                sort_by_name=self.sort_check.isChecked(),
                scan_order=self._scan_order,
            )
            section = FolderSectionWidget(folder)
            section.set_pinned(folder in self._pinned_folders)
            section.load_parts(sorted_parts, self._included)
            section.pin_toggled.connect(self._on_pin_toggled)
            section.inclusion_changed.connect(self._on_section_inclusion_changed)
            self._section_widgets[folder] = section
            self.sections_layout.insertWidget(self.sections_layout.count() - 1, section)

        total = len(self._parts)
        inc_count = sum(1 for p in self._parts if p.match_key in self._included)
        showing = len(visible)
        text = f"{inc_count} of {total} parts included for printing"
        if showing != total:
            text += f" · showing {showing} of {total} parts"
        self.summary.setText(text)
        self._update_bulk_button_labels()

    def _on_pin_toggled(self, folder: str, pinned: bool) -> None:
        if pinned and folder not in self._pinned_folders:
            self._pinned_folders.append(folder)
        elif not pinned and folder in self._pinned_folders:
            self._pinned_folders.remove(folder)
        self._rebuild_ui()

    def _on_section_inclusion_changed(self) -> None:
        for folder, section in self._section_widgets.items():
            for part in section._parts:
                if part.match_key in section._included:
                    self._included.add(part.match_key)
                else:
                    self._included.discard(part.match_key)
        self._rebuild_suggestions()
        self._rebuild_ui()

    def _set_selected_visible(self, included: bool) -> None:
        keys: list[str] = []
        for section in self._section_widgets.values():
            keys.extend(section.selected_match_keys())
        if not keys:
            QMessageBox.information(self, "Selection", "Select one or more parts in the tables.")
            return
        for key in keys:
            if included:
                self._included.add(key)
            else:
                self._included.discard(key)
        self._rebuild_suggestions()
        self._rebuild_ui()

    def _include_all(self) -> None:
        apply_bulk_include(self._included, self._visible_match_keys())
        self._rebuild_suggestions()
        self._rebuild_ui()

    def _exclude_all(self) -> None:
        apply_bulk_exclude(self._included, self._visible_match_keys())
        self._rebuild_suggestions()
        self._rebuild_ui()
