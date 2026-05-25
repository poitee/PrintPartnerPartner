"""Projects tab — CRUD and git sync."""

from __future__ import annotations

import json
from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMenu,
    QMessageBox,
    QProgressDialog,
    QPushButton,
    QRadioButton,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from print_partner.core.datetime_display import format_last_synced
from print_partner.core.git_sync import short_commit_sha
from print_partner.core.import_rules import (
    count_matching_stls,
    import_rules_for_project,
    serialize_import_rules,
)
from print_partner.core.project_import import (
    materialize_local_selection,
    register_local_project_path,
)
from print_partner.db.models import Project
from print_partner.db.session import db_session, list_projects
from print_partner.ui.empty_state import EmptyStateWidget
from print_partner.ui.path_picker import (
    DirectoryPathEdit,
    choose_directory,
    resolve_directory_input,
)
from print_partner.ui.remote_check_worker import RemoteCheckSpec, RemoteCheckWorker
from print_partner.ui.repo_import_dialog import RepoImportDialog
from print_partner.ui.sync_worker import SyncAllWorker, SyncProjectSpec
from print_partner.ui.table_layout import configure_table_columns


class ProjectDialog(QDialog):
    def __init__(
        self,
        project: Project | None = None,
        parent=None,
        *,
        initial_local_folder: Path | None = None,
    ):
        super().__init__(parent)
        self.setWindowTitle("Add local folder" if initial_local_folder else "Project")
        self._project = project
        form = QFormLayout(self)
        self.name = QLineEdit(project.name if project else "")
        self.git_radio = QRadioButton("Git repository")
        self.local_radio = QRadioButton("Local folder")
        st = (project.source_type if project else "git") or "git"
        if initial_local_folder is not None:
            st = "local"
        self.git_radio.setChecked(st == "git")
        self.local_radio.setChecked(st == "local")
        type_row = QHBoxLayout()
        type_row.addWidget(self.git_radio)
        type_row.addWidget(self.local_radio)
        form.addRow("Source", type_row)
        self.url = QLineEdit(project.url if project else "")
        self.branch = QLineEdit(project.branch if project else "main")
        self.docs_url = QLineEdit(project.docs_url or "" if project else "")
        self.local_path_edit = DirectoryPathEdit()
        if project and project.local_path:
            self.local_path_edit.set_path_text(project.local_path)
        elif initial_local_folder is not None:
            self.local_path_edit.set_path_text(str(initial_local_folder))
        self.local_path_edit.path_changed.connect(self._on_local_path_changed)
        form.addRow("Name", self.name)
        form.addRow("URL / path", self.url)
        form.addRow("Branch", self.branch)
        form.addRow("Folder", self.local_path_edit)
        form.addRow("Docs URL", self.docs_url)
        self.git_radio.toggled.connect(self._on_source_type_changed)
        self._on_source_type_changed()
        if initial_local_folder is not None:
            self._on_local_path_changed()
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self._accept)
        buttons.rejected.connect(self.reject)
        form.addRow(buttons)

    def _on_source_type_changed(self) -> None:
        git = self.git_radio.isChecked()
        self.branch.setEnabled(git)
        self.local_path_edit.setEnabled(not git)
        self.local_path_edit.btn_browse.setEnabled(not git)

    def _on_local_path_changed(self) -> None:
        text = self.local_path_edit.path_text()
        if not text:
            return
        try:
            folder = Path(text).expanduser()
        except OSError:
            return
        if not self.name.text().strip() and folder.name:
            self.name.setText(folder.name)
        if not self.url.text().strip():
            self.url.setText(f"file://{folder}")

    def _accept(self) -> None:
        if self.local_radio.isChecked():
            try:
                resolve_directory_input(self.local_path_edit.path_text())
            except ValueError as exc:
                QMessageBox.warning(self, "Folder", str(exc))
                return
        self.accept()

    def values(self) -> dict:
        source_type = "local" if self.local_radio.isChecked() else "git"
        local_path: str | None = None
        if source_type == "local":
            local_path = str(resolve_directory_input(self.local_path_edit.path_text()))
        return {
            "name": self.name.text().strip(),
            "url": self.url.text().strip(),
            "branch": self.branch.text().strip() or "main",
            "docs_url": self.docs_url.text().strip() or None,
            "source_type": source_type,
            "local_path": local_path,
        }


class ProjectLibrary(QWidget):
    projects_changed = Signal()
    import_completed = Signal(int)  # project_id after rules saved

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        self._stack = QStackedWidget()
        self._empty = EmptyStateWidget(
            "No repositories yet",
            "Add a Git repository or local STL folder, then sync. "
            "Use Import files to choose which paths are included in kits.",
            cta_text="Add repository",
        )
        self._empty.cta_clicked.connect(self._add)
        self._stack.addWidget(self._empty)

        self._content = QWidget()
        content_layout = QVBoxLayout(self._content)
        content_layout.setContentsMargins(0, 0, 0, 0)
        self.table = QTableWidget(0, 8)
        self.table.setHorizontalHeaderLabels(
            [
                "Name",
                "URL",
                "Branch",
                "Local path",
                "STLs imported",
                "Last sync",
                "Commit",
                "Updates",
            ]
        )
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        configure_table_columns(
            self.table,
            stretch_columns=(1, 3),
            fixed_widths={0: 140, 2: 72, 4: 100, 5: 120, 6: 88, 7: 80},
        )
        content_layout.addWidget(self.table)
        self._stack.addWidget(self._content)
        layout.addWidget(self._stack, 1)

        self._sync_worker: SyncAllWorker | None = None
        self._sync_failures: list[str] = []
        self._updates_by_id: dict[int, str] = {}
        self._remote_queue: list[RemoteCheckSpec] = []
        self._remote_worker: RemoteCheckWorker | None = None

        row = QHBoxLayout()
        self.btn_add = QPushButton("Add repository")
        self.btn_add.setToolTip("Register a GitHub (or other Git) URL — sync downloads STLs locally.")
        self.btn_add.clicked.connect(self._add)
        row.addWidget(self.btn_add)
        self.btn_add_local = QPushButton("Add local folder…")
        self.btn_add_local.setObjectName("primaryButton")
        self.btn_add_local.setToolTip(
            "Use STLs already on disk without cloning (then Import files… for rules)."
        )
        self.btn_add_local.clicked.connect(self._add_local_folder)
        row.addWidget(self.btn_add_local)
        self.btn_sync_sel = QPushButton("Sync selected")
        self.btn_sync_sel.setToolTip("Pull latest commit for the selected Git repository.")
        self.btn_sync_sel.clicked.connect(self._sync_selected)
        row.addWidget(self.btn_sync_sel)
        self.btn_sync_all = QPushButton("Sync all")
        self.btn_sync_all.setToolTip("Sync every Git repository in the list.")
        self.btn_sync_all.clicked.connect(self._sync_all)
        row.addWidget(self.btn_sync_all)
        more = QMenu(self)
        more.addAction("Edit…", self._edit)
        more.addAction("Delete…", self._delete)
        more.addSeparator()
        more.addAction("Export repo list…", self._export_repo_list)
        more.addAction("Import repo list…", self._import_repo_list)
        more.addAction("Import repos.txt…", self._import_repos)
        more.addSeparator()
        more.addAction("Import files…", self._import_files)
        self.btn_more = QPushButton("More ▾")
        self.btn_more.setMenu(more)
        row.addWidget(self.btn_more)
        self._sync_chip = QLabel("")
        self._sync_chip.setProperty("muted", True)
        row.addWidget(self._sync_chip)
        row.addStretch(1)
        layout.addLayout(row)
        self.refresh()

    def shutdown(self) -> None:
        if self._sync_worker and self._sync_worker.isRunning():
            self._sync_worker.cancel()
            self._sync_worker.wait(8000)
        self._sync_worker = None
        if self._remote_worker and self._remote_worker.isRunning():
            self._remote_worker.wait(3000)
        self._remote_worker = None
        self._remote_queue.clear()

    @staticmethod
    def _import_status_label(proj: Project) -> str:
        if not proj.local_path:
            return "not synced"
        rules = import_rules_for_project(proj.imported_paths)
        matching, total = count_matching_stls(Path(proj.local_path), rules)
        if rules is None:
            return f"all ({total})"
        if total == 0:
            return "0 files"
        return f"{matching}/{total}"

    def remote_updates_count(self) -> int:
        return sum(1 for label in self._updates_by_id.values() if label == "Updates available")

    def _set_sync_busy(self, busy: bool) -> None:
        for btn in (
            self.btn_sync_sel,
            self.btn_sync_all,
            self.btn_add,
            self.btn_add_local,
            self.btn_more,
        ):
            btn.setEnabled(not busy)
        if not busy:
            self._sync_chip.setText("")

    def _updates_label(self, proj: Project) -> str:
        if proj.id in self._updates_by_id:
            return self._updates_by_id[proj.id]
        st = (proj.source_type or "git")
        if st == "local":
            return "Local"
        if not proj.local_path:
            return "Not synced"
        return "Checking…"

    def refresh(self) -> None:
        remote_specs: list[RemoteCheckSpec] = []
        with db_session() as session:
            projects = list_projects(session)
            self._stack.setCurrentIndex(1 if projects else 0)
            self.table.setRowCount(len(projects))
            for i, p in enumerate(projects):
                self.table.setItem(i, 0, QTableWidgetItem(p.name))
                self.table.setItem(i, 1, QTableWidgetItem(p.url))
                self.table.setItem(i, 2, QTableWidgetItem(p.branch))
                self.table.setItem(i, 3, QTableWidgetItem(p.local_path or ""))
                self.table.setItem(i, 4, QTableWidgetItem(self._import_status_label(p)))
                sync_text, sync_tip = format_last_synced(p.last_synced_at)
                sync_item = QTableWidgetItem(sync_text)
                if sync_tip:
                    sync_item.setToolTip(sync_tip)
                self.table.setItem(i, 5, sync_item)
                sha_short = short_commit_sha(p.last_commit_sha)
                sha_item = QTableWidgetItem(sha_short)
                if p.last_commit_sha:
                    sha_item.setToolTip(p.last_commit_sha)
                self.table.setItem(i, 6, sha_item)
                self.table.setItem(i, 7, QTableWidgetItem(self._updates_label(p)))
                self.table.item(i, 0).setData(Qt.UserRole, p.id)
                st = (p.source_type or "git")
                if (
                    st != "local"
                    and p.local_path
                    and p.url
                    and not p.url.startswith("file://")
                    and p.id not in self._updates_by_id
                ):
                    remote_specs.append(
                        RemoteCheckSpec(
                            p.id,
                            Path(p.local_path),
                            p.url,
                            p.branch or "main",
                            p.last_commit_sha,
                        )
                    )
        self._schedule_remote_checks(remote_specs)

    def _schedule_remote_checks(self, specs: list[RemoteCheckSpec]) -> None:
        self._remote_queue = list(specs)
        self._start_next_remote_check()

    def _start_next_remote_check(self) -> None:
        if self._remote_worker and self._remote_worker.isRunning():
            return
        if not self._remote_queue:
            return
        spec = self._remote_queue.pop(0)
        self._remote_worker = RemoteCheckWorker(spec, parent=self)
        self._remote_worker.result.connect(self._on_remote_check_result)
        self._remote_worker.finished.connect(self._on_remote_check_finished)
        self._remote_worker.start()

    def _on_remote_check_result(self, project_id: int, label: str) -> None:
        self._updates_by_id[project_id] = label
        for row in range(self.table.rowCount()):
            item = self.table.item(row, 0)
            if item and item.data(Qt.UserRole) == project_id:
                self.table.setItem(row, 7, QTableWidgetItem(label))
                break

    def _on_remote_check_finished(self) -> None:
        self._remote_worker = None
        if not self._remote_queue:
            win = self.window()
            if hasattr(win, "set_libraries_tab_badge"):
                win.set_libraries_tab_badge(self.remote_updates_count())
        self._start_next_remote_check()

    def _selected_id(self) -> int | None:
        rows = self.table.selectionModel().selectedRows()
        if not rows:
            return None
        item = self.table.item(rows[0].row(), 0)
        return item.data(Qt.UserRole) if item else None

    def _local_source_dir(self, proj: Project) -> Path | None:
        if proj.url.startswith("file://"):
            return Path(proj.url.removeprefix("file://"))
        if proj.local_path:
            return Path(proj.local_path)
        return None

    def _open_import_dialog(self, pid: int, *, prompt_if_empty: bool = False) -> bool:
        with db_session() as session:
            proj = session.get(Project, pid)
            if not proj or not proj.local_path:
                QMessageBox.information(
                    self,
                    "Import files",
                    "Sync or add the project with a local folder first.",
                )
                return False
            repo_root = Path(proj.local_path)
            if not repo_root.is_dir():
                QMessageBox.warning(self, "Import files", f"Folder not found:\n{repo_root}")
                return False
            rules = import_rules_for_project(proj.imported_paths)
            if prompt_if_empty and rules is not None and len(rules) == 0:
                total = len(list(repo_root.rglob("*.stl"))) if repo_root.is_dir() else 0
                if total > 0:
                    reply = QMessageBox.question(
                        self,
                        "Choose files to import",
                        f"This repository has {total} STL files.\n\n"
                        "Select which files to include in profiles? "
                        "(Recommended — much faster than importing everything.)",
                        QMessageBox.Yes | QMessageBox.No,
                        QMessageBox.Yes,
                    )
                    if reply != QMessageBox.Yes:
                        return False
            dlg = RepoImportDialog(repo_root, rules, project_name=proj.name, parent=self)
            if dlg.exec() != QDialog.Accepted:
                return False
            new_rules = dlg.rules()
            proj.imported_paths = serialize_import_rules(new_rules)
            if (proj.source_type or "git") == "local":
                source = self._local_source_dir(proj)
                if source and source.is_dir() and new_rules:
                    try:
                        dest = materialize_local_selection(proj.name, source, new_rules)
                        proj.local_path = str(dest)
                    except Exception as exc:
                        QMessageBox.warning(
                            self,
                            "Copy selected files",
                            f"Saved import rules, but copying files failed:\n{exc}",
                        )
        self.refresh()
        self.projects_changed.emit()
        self.import_completed.emit(pid)
        return True

    def _import_files(self) -> None:
        pid = self._selected_id()
        if pid is None:
            QMessageBox.information(self, "Import files", "Select a project first.")
            return
        self._open_import_dialog(pid)

    def _add_local_folder(self) -> None:
        picked = choose_directory(self, "Select STL folder")
        if picked is None:
            return
        dlg = ProjectDialog(parent=self, initial_local_folder=picked)
        if dlg.exec() != QDialog.Accepted:
            return
        self._save_new_project(dlg.values())

    def _add(self) -> None:
        dlg = ProjectDialog(parent=self)
        if dlg.exec() != QDialog.Accepted:
            return
        self._save_new_project(dlg.values())

    def _save_new_project(self, v: dict) -> None:
        if not v["name"]:
            QMessageBox.warning(self, "Validation", "Name is required.")
            return
        new_id: int | None = None
        if v["source_type"] == "local":
            folder = v.get("local_path") or v["url"].removeprefix("file://")
            if not folder:
                QMessageBox.warning(self, "Validation", "Choose a local folder.")
                return
            try:
                result = register_local_project_path(v["name"], Path(folder))
            except Exception as exc:
                QMessageBox.critical(self, "Import failed", str(exc))
                return
            v["local_path"] = str(result.local_path)
            v["last_synced_at"] = result.last_synced_at
            if not v["url"]:
                v["url"] = f"file://{folder}"
        elif not v["url"]:
            QMessageBox.warning(self, "Validation", "URL is required for Git projects.")
            return
        with db_session() as session:
            proj = Project(**v)
            session.add(proj)
            session.flush()
            new_id = proj.id
        self.refresh()
        self.projects_changed.emit()
        if new_id is not None:
            self._open_import_dialog(new_id, prompt_if_empty=True)

    def _edit(self) -> None:
        pid = self._selected_id()
        if pid is None:
            return
        with db_session() as session:
            proj = session.get(Project, pid)
            if not proj:
                return
            dlg = ProjectDialog(proj, self)
            if dlg.exec() != QDialog.Accepted:
                return
            try:
                v = dlg.values()
            except ValueError as exc:
                QMessageBox.warning(self, "Folder", str(exc))
                return
            for k, val in v.items():
                if k == "imported_paths":
                    continue
                setattr(proj, k, val)
        self.refresh()
        self.projects_changed.emit()

    def _delete(self) -> None:
        pid = self._selected_id()
        if pid is None:
            return
        with db_session() as session:
            proj = session.get(Project, pid)
            if proj:
                session.delete(proj)
        self.refresh()
        self.projects_changed.emit()

    def _export_repo_list(self) -> None:
        from print_partner.config import settings
        from print_partner.core.repo_list_io import export_repo_list_file

        default = str(settings.exports_dir / "repo-list.json")
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Export repository list",
            default,
            "JSON (*.json);;All files (*)",
        )
        if not path:
            return
        try:
            with db_session() as session:
                export_repo_list_file(session, Path(path))
        except OSError as exc:
            QMessageBox.critical(self, "Export", str(exc))
            return
        QMessageBox.information(
            self,
            "Exported",
            "Repository list saved. Share this JSON with another Print Partner install "
            "(Import repo list…). Sync and import rules are still per machine.",
        )

    def _import_repo_list(self) -> None:
        from print_partner.core.repo_list_io import import_repo_list_file

        path, _ = QFileDialog.getOpenFileName(
            self,
            "Import repository list",
            "",
            "JSON (*.json);;All files (*)",
        )
        if not path:
            return
        try:
            with db_session() as session:
                count = import_repo_list_file(session, Path(path))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            QMessageBox.critical(self, "Import", str(exc))
            return
        QMessageBox.information(
            self,
            "Import",
            f"Merged {count} repository(ies).\n\nSync Git repos, then Import files… for each.",
        )
        self.refresh()
        self.projects_changed.emit()

    def _import_repos(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Import repos.txt", "", "Text (*.txt)")
        if not path:
            return
        count = 0
        with db_session() as session:
            for line in open(path, encoding="utf-8"):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = [p.strip() for p in line.split(",")]
                if len(parts) < 2:
                    continue
                name, url = parts[0], parts[1]
                branch = parts[2] if len(parts) > 2 else "main"
                from sqlalchemy import select

                existing = session.scalars(select(Project).where(Project.name == name)).first()
                if existing:
                    existing.url = url
                    existing.branch = branch
                else:
                    session.add(
                        Project(
                            name=name,
                            url=url,
                            branch=branch,
                        )
                    )
                count += 1
        QMessageBox.information(
            self,
            "Import",
            f"Registered {count} project(s).\n\nSync each repo, then use Import files to choose STLs.",
        )
        self.refresh()
        self.projects_changed.emit()

    def _sync_selected(self) -> None:
        pid = self._selected_id()
        if pid is None:
            QMessageBox.information(self, "Sync", "Select a project first.")
            return
        with db_session() as session:
            proj = session.get(Project, pid)
            if not proj:
                return
            if (proj.source_type or "git") == "local":
                QMessageBox.information(
                    self,
                    "Sync",
                    "Local folder projects use the folder path directly. "
                    "Use Import files to choose STLs.",
                )
                return
            spec = SyncProjectSpec(proj.id, proj.name, proj.url, proj.branch or "main")

        def on_complete() -> None:
            self.refresh()
            self.projects_changed.emit()
            QMessageBox.information(self, "Sync", "Repository synced.")
            self._open_import_dialog(pid, prompt_if_empty=True)

        self._start_sync_worker([spec], title="Syncing repository…", on_success=on_complete)

    def _start_sync_worker(
        self,
        specs: list[SyncProjectSpec],
        *,
        title: str,
        on_success: callable | None = None,
        all_done_message: str | None = None,
    ) -> None:
        if self._sync_worker and self._sync_worker.isRunning():
            return
        progress = QProgressDialog(title, "Cancel", 0, len(specs), self)
        progress.setWindowModality(Qt.WindowModal)
        progress.setMinimumDuration(0)
        progress.setValue(0)

        self._sync_failures = []
        self._sync_worker = SyncAllWorker(specs)
        self._set_sync_busy(True)

        def on_progress(i: int, total: int, name: str) -> None:
            progress.setMaximum(max(1, total))
            progress.setLabelText(f"Syncing {name} ({i}/{total})…")
            progress.setValue(i)
            self._sync_chip.setText(f"Syncing {i} of {total}…")
            if progress.wasCanceled() and self._sync_worker:
                self._sync_worker.cancel()

        def on_done(project_id: int, result: object) -> None:
            if isinstance(result, Exception):
                with db_session() as session:
                    proj = session.get(Project, project_id)
                    label = proj.name if proj else str(project_id)
                self._sync_failures.append(f"{label}: {result}")
                return
            with db_session() as session:
                proj = session.get(Project, project_id)
                if proj:
                    proj.local_path = str(result.local_path)
                    proj.last_synced_at = result.last_synced_at
                    proj.last_commit_sha = result.commit_sha
            self._updates_by_id[project_id] = "Up to date"

        def on_finished() -> None:
            progress.close()
            self._sync_worker = None
            self._set_sync_busy(False)
            self.refresh()
            self.projects_changed.emit()
            win = self.window()
            if hasattr(win, "set_libraries_tab_badge"):
                win.set_libraries_tab_badge(self.remote_updates_count())
            if self._sync_failures:
                QMessageBox.warning(
                    self,
                    "Sync",
                    f"Synced with {len(self._sync_failures)} error(s):\n\n"
                    + "\n".join(self._sync_failures[:12])
                    + ("\n…" if len(self._sync_failures) > 12 else ""),
                )
            elif on_success:
                on_success()
            elif all_done_message:
                from print_partner.ui.toast import show_toast

                show_toast(self, all_done_message.replace("\n\n", " "))

        self._sync_worker.progress.connect(on_progress)
        self._sync_worker.project_done.connect(on_done)
        self._sync_worker.finished.connect(on_finished)
        self._sync_worker.start()

    def _sync_all(self) -> None:
        with db_session() as session:
            projects = list_projects(session)
            if not projects:
                QMessageBox.information(self, "Sync all", "No projects to sync.")
                return
            specs = [
                SyncProjectSpec(p.id, p.name, p.url, p.branch or "main")
                for p in projects
                if (p.source_type or "git") != "local"
            ]

        if not specs:
            QMessageBox.information(self, "Sync all", "No Git projects to sync.")
            return

        self._start_sync_worker(
            specs,
            title="Preparing sync…",
            all_done_message=(
                f"Synced {len(specs)} project(s).\n\n"
                "Use Import files on each repo to choose which STLs to include."
            ),
        )
