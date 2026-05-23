"""README and cross-layer suggestions for profile Build tab."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from print_partner.core.parts_suggestions import (
    DEFAULT_FUZZY_THRESHOLD,
    Suggestion,
    build_suggestions,
)
from print_partner.core.profile_parts_adapter import display_dict_to_scanned
from print_partner.core.readme_hints import ReadmeHint, hints_from_repo


class ProfileSuggestionsPanel(QWidget):
    """Heuristic suggestions (no LLM). Emits part ids to include or exclude."""

    inclusion_suggested = Signal(set, set)  # include_ids, exclude_ids

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._part_dicts: list[dict] = []
        self._match_key_to_id: dict[str, int] = {}
        self._included_ids: set[int] = set()
        self._suggestions: list[Suggestion] = []
        self._dismissed = False

        self._box = QGroupBox("Suggestions")
        self._box.setCheckable(True)
        self._box.setChecked(True)
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.addWidget(self._box)

        box_layout = QVBoxLayout(self._box)
        hint = QLabel(
            "From README hints and fuzzy matches across layers. Review before applying."
        )
        hint.setProperty("muted", True)
        hint.setWordWrap(True)
        box_layout.addWidget(hint)

        self._table = QTableWidget(0, 5)
        self._table.setHorizontalHeaderLabels(["Source", "Action", "Part", "Reason", ""])
        self._table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self._table.setMaximumHeight(140)
        box_layout.addWidget(self._table)

        row = QHBoxLayout()
        self._btn_apply_inc = QPushButton("Apply includes")
        self._btn_apply_inc.clicked.connect(lambda: self._apply_batch("include"))
        self._btn_apply_exc = QPushButton("Apply excludes")
        self._btn_apply_exc.clicked.connect(lambda: self._apply_batch("exclude"))
        self._btn_dismiss = QPushButton("Dismiss")
        self._btn_dismiss.clicked.connect(self._dismiss)
        row.addWidget(self._btn_apply_inc)
        row.addWidget(self._btn_apply_exc)
        row.addStretch(1)
        row.addWidget(self._btn_dismiss)
        box_layout.addLayout(row)
        self.hide()

    def load_profile_parts(
        self,
        part_dicts: list[dict],
        *,
        readme_repo_paths: list[Path] | None = None,
        reference_layers: list[tuple[str, list, set[str]]] | None = None,
    ) -> None:
        self._part_dicts = list(part_dicts)
        self._match_key_to_id = {r["match_key"]: int(r["id"]) for r in part_dicts}
        self._included_ids = {int(r["id"]) for r in part_dicts if r.get("included")}
        scanned = [display_dict_to_scanned(r) for r in part_dicts]
        included_keys = {r["match_key"] for r in part_dicts if r.get("included")}

        readme_hints: list[ReadmeHint] = []
        for repo_path in readme_repo_paths or []:
            if repo_path.is_dir():
                readme_hints.extend(hints_from_repo(repo_path, scanned))

        if self._dismissed or not part_dicts:
            self._suggestions = []
        else:
            self._suggestions = build_suggestions(
                scanned,
                included_keys,
                reference_layers=reference_layers,
                readme_hints=readme_hints or None,
                fuzzy_threshold=DEFAULT_FUZZY_THRESHOLD,
            )

        self._rebuild_table()

    def _rebuild_table(self) -> None:
        has = bool(self._suggestions)
        self.setVisible(has)
        self._table.setRowCount(len(self._suggestions))
        for i, sug in enumerate(self._suggestions):
            row = next((r for r in self._part_dicts if r["match_key"] == sug.target_match_key), None)
            name = row["filename"] if row else sug.target_match_key
            self._table.setItem(i, 0, QTableWidgetItem(sug.source))
            self._table.setItem(i, 1, QTableWidgetItem(sug.action))
            self._table.setItem(i, 2, QTableWidgetItem(name))
            reason_item = QTableWidgetItem(sug.reason)
            reason_item.setToolTip(sug.reason)
            self._table.setItem(i, 3, reason_item)
            btn = QPushButton("Apply")
            btn.clicked.connect(lambda checked=False, s=sug: self._apply_one(s))
            self._table.setCellWidget(i, 4, btn)

    def _apply_one(self, sug: Suggestion) -> None:
        pid = self._match_key_to_id.get(sug.target_match_key)
        if pid is None:
            return
        if sug.action == "include":
            self.inclusion_suggested.emit({pid}, set())
        else:
            self.inclusion_suggested.emit(set(), {pid})
        self._suggestions = [s for s in self._suggestions if s.target_match_key != sug.target_match_key]
        self._rebuild_table()

    def _apply_batch(self, action: str) -> None:
        include_ids: set[int] = set()
        exclude_ids: set[int] = set()
        for sug in self._suggestions:
            if sug.action != action:
                continue
            pid = self._match_key_to_id.get(sug.target_match_key)
            if pid is None:
                continue
            if action == "include":
                include_ids.add(pid)
            else:
                exclude_ids.add(pid)
        if include_ids or exclude_ids:
            self.inclusion_suggested.emit(include_ids, exclude_ids)
        self._suggestions = []
        self._rebuild_table()

    def _dismiss(self) -> None:
        self._dismissed = True
        self._suggestions = []
        self._rebuild_table()

    def reset_dismissed(self) -> None:
        self._dismissed = False
