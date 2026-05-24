"""Profile parts curation panel (tree on Build / Verify; checklist on Checkoff)."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QCheckBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from print_partner.core.parts_grouping import folder_scan_order
from print_partner.core.profile_parts_adapter import display_dict_to_scanned, filter_profile_dicts
from print_partner.core.scanner import ScannedPart
from print_partner.ui.parts_tree_widget import PartsTreeWidget
from print_partner.ui.print_checklist_widget import PrintChecklistWidget

PartsPanelMode = Literal["build", "verify_chosen", "checkoff"]


class ProfilePartsPanel(QWidget):
    part_selected = Signal(int)
    tree_path_selected = Signal(str, str)
    visible_part_ids_changed = Signal()

    _PAGE_TREE = 0
    _PAGE_CHECKLIST = 1

    def __init__(self, parent=None):
        super().__init__(parent)
        self._panel_mode: PartsPanelMode = "build"
        self._all_rows: list[dict] = []
        self._display_rows: list[dict] = []
        self._included_part_ids: set[int] = set()
        self._scan_order: dict[str, int] = {}
        self._folder_scan_order: list[str] = []
        self._pinned_folders: list[str] = []
        self._hide_printed = False
        self._inclusion_changed_cb = None
        self._quantity_changed_cb = None
        self._all_printed_toggled_cb = None
        self._print_toggle_cb = None

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)

        self.hint = QLabel(
            "Curate parts for this profile. Expand repos and folders; check a folder to include its subtree."
        )
        self.hint.setProperty("muted", True)
        self.hint.setWordWrap(True)
        root.addWidget(self.hint)

        self._stack = QStackedWidget()
        self._tree_page = QWidget()
        tree_layout = QVBoxLayout(self._tree_page)
        tree_layout.setContentsMargins(0, 0, 0, 0)
        self.parts_tree = PartsTreeWidget(mode="profile")
        self._tree_toolbar_host = QWidget()
        tree_toolbar = QHBoxLayout(self._tree_toolbar_host)
        tree_toolbar.setContentsMargins(0, 0, 0, 0)
        self.filter_edit = QLineEdit()
        self.filter_edit.setPlaceholderText("Filter parts…")
        self.filter_edit.setClearButtonEnabled(True)
        self.filter_edit.textChanged.connect(self._on_filter_changed)
        tree_toolbar.addWidget(self.filter_edit, 1)
        expand_btn = QPushButton("Expand all")
        expand_btn.clicked.connect(self.parts_tree.expand_all)
        tree_toolbar.addWidget(expand_btn)
        collapse_btn = QPushButton("Collapse all")
        collapse_btn.clicked.connect(self.parts_tree.collapse_all)
        tree_toolbar.addWidget(collapse_btn)
        self.sort_check = QCheckBox("Sort by name")
        self.sort_check.setChecked(True)
        self.sort_check.toggled.connect(self._on_sort_changed)
        tree_toolbar.addWidget(self.sort_check)
        self.hide_printed_check = QCheckBox("Hide fully printed")
        self.hide_printed_check.toggled.connect(self._on_hide_printed)
        tree_toolbar.addWidget(self.hide_printed_check)
        self.summary = QLabel("")
        self.summary.setObjectName("partsSummary")
        self.summary.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        tree_toolbar.addWidget(self.summary, 1)
        tree_layout.addWidget(self._tree_toolbar_host)
        self.parts_tree.inclusion_changed.connect(self._on_tree_inclusion_changed)
        self.parts_tree.part_selected.connect(self.part_selected.emit)
        self.parts_tree.tree_path_selected.connect(self.tree_path_selected.emit)
        self.parts_tree.quantity_changed.connect(self._on_quantity_changed)
        self.parts_tree.all_printed_toggled.connect(self._on_all_printed_toggled)
        tree_layout.addWidget(self.parts_tree, 1)
        self._stack.addWidget(self._tree_page)

        self.print_checklist = PrintChecklistWidget()
        self.print_checklist.printed_toggled.connect(self._on_all_printed_toggled)
        self.print_checklist.part_selected.connect(self.part_selected.emit)
        self._stack.addWidget(self.print_checklist)

        root.addWidget(self._stack, 1)

        self._bulk_buttons_host = QWidget()
        buttons = QHBoxLayout(self._bulk_buttons_host)
        buttons.setContentsMargins(0, 0, 0, 0)
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
        root.addWidget(self._bulk_buttons_host)

    def set_panel_mode(self, mode: PartsPanelMode) -> None:
        self._panel_mode = mode
        if mode == "build":
            self._stack.setCurrentIndex(self._PAGE_TREE)
            self.hint.setText(
                "Curate parts for this profile. Expand repos and folders; check a folder to include its subtree."
            )
            self._tree_toolbar_host.setVisible(True)
            self._bulk_buttons_host.setVisible(True)
            self.btn_include.setVisible(True)
            self.btn_all.setVisible(True)
            self.summary.setVisible(True)
        elif mode == "verify_chosen":
            self._stack.setCurrentIndex(self._PAGE_TREE)
            self.hint.setText(
                "Review parts included for printing. Uncheck Print to remove a part from the kit."
            )
            self._tree_toolbar_host.setVisible(True)
            self._bulk_buttons_host.setVisible(True)
            self.btn_include.setVisible(False)
            self.btn_all.setVisible(False)
            self.summary.setVisible(True)
            self.hide_printed_check.setChecked(False)
            self._hide_printed = False
        else:
            self.hide_printed_check.setChecked(False)
            self._hide_printed = False
            self._stack.setCurrentIndex(self._PAGE_CHECKLIST)
            self.hint.setText(
                "Check off parts as you print. Progress is saved to this profile. "
                "Export HTML for a printable checklist."
            )
            self._tree_toolbar_host.setVisible(False)
            self._bulk_buttons_host.setVisible(False)
            self.summary.setVisible(False)

        if mode in ("build", "verify_chosen") and self._all_rows:
            self._rebuild_tree()
            self._update_summary()
        elif mode == "checkoff" and self._all_rows:
            self.print_checklist.load_rows(self._all_rows)  # header set via load_parts

    def set_callbacks(
        self,
        on_inclusion_changed,
        on_print_toggle=None,
        on_quantity_changed=None,
        on_all_printed_toggled=None,
    ) -> None:
        self._inclusion_changed_cb = on_inclusion_changed
        self._print_toggle_cb = on_print_toggle
        self._quantity_changed_cb = on_quantity_changed
        self._all_printed_toggled_cb = on_all_printed_toggled

    def load_parts(
        self,
        all_rows: list[dict],
        display_rows: list[dict],
        *,
        readme_repo_paths: list[Path] | None = None,
        reference_layers: list[tuple[str, list[ScannedPart], set[str]]] | None = None,
        profile_name: str = "",
        order_number: str | None = None,
    ) -> None:
        """Load snapshots only — never pass detached ORM Part instances."""
        self._all_rows = list(all_rows)
        self._display_rows = list(display_rows)
        self._included_part_ids = {r["id"] for r in all_rows if r["included"]}
        scanned = [display_dict_to_scanned(r) for r in all_rows]
        self._scan_order = {s.match_key: i for i, s in enumerate(scanned)}
        self._folder_scan_order = folder_scan_order(scanned)
        if self._panel_mode in ("build", "verify_chosen"):
            self._rebuild_tree()
            self._update_summary()
        else:
            self.print_checklist.set_header(profile_name, order_number)
            self.print_checklist.load_rows(self._all_rows)

    def visible_part_ids(self) -> set[int]:
        return self._visible_part_ids()

    def _rows_for_tree(self) -> list[dict]:
        if self._panel_mode == "verify_chosen":
            return [r for r in self._all_rows if r["id"] in self._included_part_ids]
        return self._all_rows

    def _base_display_rows(self) -> list[dict]:
        if self._panel_mode == "verify_chosen":
            return [d for d in self._display_rows if d["id"] in self._included_part_ids]
        return self._display_rows

    def _visible_part_ids(self) -> set[int]:
        return {r["id"] for r in self._visible_rows()}

    def _visible_rows(self) -> list[dict]:
        text_filtered = filter_profile_dicts(self._rows_for_tree(), self.filter_edit.text())
        text_ids = {r["id"] for r in text_filtered}
        result: list[dict] = []
        for d in self._base_display_rows():
            if d["id"] not in text_ids:
                continue
            if self._hide_printed and self._panel_mode == "build":
                qty = max(1, d.get("quantity_effective", 1))
                if d.get("printed_count", 0) >= qty:
                    continue
            result.append(d)
        return result

    def _on_hide_printed(self) -> None:
        self._hide_printed = self.hide_printed_check.isChecked()
        self.parts_tree.set_hide_printed(self._hide_printed)
        self._update_summary()
        self.visible_part_ids_changed.emit()

    def _on_sort_changed(self) -> None:
        self.parts_tree.set_sort_by_name(self.sort_check.isChecked())
        self._update_summary()

    def _on_filter_changed(self) -> None:
        self._update_bulk_button_labels()
        self.parts_tree.schedule_filter_rebuild(self.filter_edit.text())
        self._update_summary()
        self.visible_part_ids_changed.emit()

    def _rebuild_tree(self) -> None:
        tree_rows = self._rows_for_tree()
        self.parts_tree.set_pinned_folders(self._pinned_folders)
        self.parts_tree.set_sort_by_name(self.sort_check.isChecked())
        hide_printed = self._hide_printed and self._panel_mode == "build"
        self.parts_tree.set_hide_printed(hide_printed)
        self.parts_tree.set_filter_text(self.filter_edit.text(), immediate=True)
        self.parts_tree.load_profile_parts(
            tree_rows,
            self._included_part_ids,
            scan_order=self._scan_order,
            folder_scan_order=self._folder_scan_order,
        )

    def _update_summary(self) -> None:
        if self._panel_mode == "verify_chosen":
            chosen = len(self._included_part_ids)
            showing = len(self._visible_rows())
            text = f"{chosen} part(s) chosen for printing"
            if showing != chosen:
                text += f" · showing {showing} of {chosen}"
            self.summary.setText(text)
            self._update_bulk_button_labels()
            return

        total = len(self._all_rows)
        inc_count = sum(1 for r in self._all_rows if r["id"] in self._included_part_ids)
        showing = len(self._visible_rows())
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

    def _on_tree_inclusion_changed(self, included: set[int]) -> None:
        self._included_part_ids = set(included)
        if self._inclusion_changed_cb:
            self._inclusion_changed_cb(self._included_part_ids)
        if self._panel_mode == "verify_chosen":
            self._rebuild_tree()
        self._update_summary()

    def _on_quantity_changed(self, part_id: int, value: int) -> None:
        if self._quantity_changed_cb:
            self._quantity_changed_cb(part_id, value)

    def _on_all_printed_toggled(self, part_id: int, all_printed: bool) -> None:
        if self._all_printed_toggled_cb:
            self._all_printed_toggled_cb(part_id, all_printed)

    def _set_selected_visible(self, included: bool) -> None:
        ids = self.parts_tree.selected_part_ids()
        if not ids:
            QMessageBox.information(self, "Selection", "Select one or more parts in the tree.")
            return
        for pid in ids:
            if included:
                self._included_part_ids.add(pid)
            else:
                self._included_part_ids.discard(pid)
        if self._inclusion_changed_cb:
            self._inclusion_changed_cb(self._included_part_ids)
        self._rebuild_tree()
        self._update_summary()

    def _include_all(self) -> None:
        visible_ids = {r["id"] for r in self._visible_rows()}
        self._included_part_ids.update(visible_ids)
        if self._inclusion_changed_cb:
            self._inclusion_changed_cb(self._included_part_ids)
        self._rebuild_tree()
        self._update_summary()

    def _exclude_all(self) -> None:
        visible_ids = {r["id"] for r in self._visible_rows()}
        self._included_part_ids.difference_update(visible_ids)
        if self._inclusion_changed_cb:
            self._inclusion_changed_cb(self._included_part_ids)
        self._rebuild_tree()
        self._update_summary()

    def refresh_progress_rows(self, all_rows: list[dict], display_rows: list[dict]) -> None:
        """Update printed counts on Build/Verify without a full load_parts pass."""
        self._all_rows = list(all_rows)
        self._display_rows = list(display_rows)
        if self._panel_mode in ("build", "verify_chosen"):
            self._rebuild_tree()
            self._update_summary()

    def refresh_checkoff_rows(self, all_rows: list[dict]) -> None:
        """Update printed state on Checkoff without rebuilding Build/Verify filters."""
        self._all_rows = list(all_rows)
        if self._panel_mode == "checkoff":
            self.print_checklist.refresh_rows(self._all_rows)

    def refresh_display_rows(self, display_rows: list[dict]) -> None:
        """Update printed counts without full part reload."""
        self._display_rows = list(display_rows)
        if self._panel_mode in ("build", "verify_chosen"):
            self._rebuild_tree()
            self._update_summary()
        else:
            self.print_checklist.refresh_rows(self._all_rows)
