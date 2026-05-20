"""Reusable parts curation with collapsible tree, filter, and suggestions."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
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
    match_keys_for_parts,
)
from print_partner.core.parts_suggestions import DEFAULT_FUZZY_THRESHOLD, Suggestion, build_suggestions
from print_partner.core.readme_hints import ReadmeHint, hints_from_repo
from print_partner.core.scanner import ScannedPart
from print_partner.ui.parts_tree_widget import PartsTreeWidget


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

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)

        hint = QLabel("Select parts to print. Shift/Cmd+click for multiple rows.")
        hint.setStyleSheet("color: #555;")
        root.addWidget(hint)

        self.parts_tree = PartsTreeWidget(mode="wizard")

        toolbar = QHBoxLayout()
        self.filter_edit = QLineEdit()
        self.filter_edit.setPlaceholderText("Filter parts…")
        self.filter_edit.setClearButtonEnabled(True)
        self.filter_edit.textChanged.connect(self._on_filter_changed)
        toolbar.addWidget(self.filter_edit, 1)
        expand_btn = QPushButton("Expand all")
        expand_btn.clicked.connect(self.parts_tree.expand_all)
        toolbar.addWidget(expand_btn)
        collapse_btn = QPushButton("Collapse all")
        collapse_btn.clicked.connect(self.parts_tree.collapse_all)
        toolbar.addWidget(collapse_btn)
        self.sort_check = QCheckBox("Sort by name")
        self.sort_check.setChecked(True)
        self.sort_check.toggled.connect(self._on_sort_changed)
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

        self.parts_tree.inclusion_changed.connect(self._on_tree_inclusion_changed)
        root.addWidget(self.parts_tree, 1)

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
        self._rebuild_tree()
        self._update_summary()

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
        self._rebuild_tree()
        self._update_summary()

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
        self._rebuild_tree()
        self._update_summary()

    def _dismiss_suggestions(self) -> None:
        self._suggestions_dismissed = True
        self._rebuild_suggestions()

    def _visible_parts(self) -> list[ScannedPart]:
        return filter_parts(self._parts, self.filter_edit.text())

    def _visible_match_keys(self) -> set[str]:
        return match_keys_for_parts(self._visible_parts())

    def _on_filter_changed(self) -> None:
        self._update_bulk_button_labels()
        self.parts_tree.schedule_filter_rebuild(self.filter_edit.text())
        self._update_summary()

    def _on_sort_changed(self) -> None:
        self.parts_tree.set_sort_by_name(self.sort_check.isChecked())
        self._update_summary()

    def _rebuild_tree(self) -> None:
        self.parts_tree.set_pinned_folders(self._pinned_folders)
        self.parts_tree.set_sort_by_name(self.sort_check.isChecked())
        self.parts_tree.set_filter_text(self.filter_edit.text(), immediate=True)
        self.parts_tree.load_wizard_parts(
            self._parts,
            self._included,
            scan_order=self._scan_order,
            folder_scan_order=self._folder_scan_order,
        )

    def _update_summary(self) -> None:
        total = len(self._parts)
        inc_count = sum(1 for p in self._parts if p.match_key in self._included)
        showing = len(self._visible_parts())
        text = f"{inc_count} of {total} parts included for printing"
        if showing != total:
            text += f" · showing {showing} of {total} parts"
        self.summary.setText(text)
        self._update_bulk_button_labels()

    def _update_bulk_button_labels(self) -> None:
        if self.filter_edit.text().strip():
            self.btn_all.setText("Include all shown")
            self.btn_none.setText("Exclude all shown")
        else:
            self.btn_all.setText("Include all")
            self.btn_none.setText("Exclude all")

    def _on_tree_inclusion_changed(self, included: set[str]) -> None:
        self._included = set(included)
        self._rebuild_suggestions()
        self._update_summary()

    def _set_selected_visible(self, included: bool) -> None:
        keys = self.parts_tree.selected_match_keys()
        if not keys:
            QMessageBox.information(self, "Selection", "Select one or more parts in the tree.")
            return
        for key in keys:
            if included:
                self._included.add(key)
            else:
                self._included.discard(key)
        self._rebuild_suggestions()
        self._rebuild_tree()
        self._update_summary()

    def _include_all(self) -> None:
        apply_bulk_include(self._included, self._visible_match_keys())
        self._rebuild_suggestions()
        self._rebuild_tree()
        self._update_summary()

    def _exclude_all(self) -> None:
        apply_bulk_exclude(self._included, self._visible_match_keys())
        self._rebuild_suggestions()
        self._rebuild_tree()
        self._update_summary()
