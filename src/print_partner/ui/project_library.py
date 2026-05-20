"""Projects tab — CRUD and git sync."""

from __future__ import annotations

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
    QMessageBox,
    QProgressDialog,
    QPushButton,
    QRadioButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

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
from print_partner.ui.repo_import_dialog import RepoImportDialog
from print_partner.ui.sync_worker import SyncAllWorker, SyncProjectSpec


class ProjectDialog(QDialog):
    def __init__(self, project: Project | None = None, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Project")
        self._project = project
        form = QFormLayout(self)
        self.name = QLineEdit(project.name if project else "")
        self.git_radio = QRadioButton("Git repository")
        self.local_radio = QRadioButton("Local folder")
        st = (project.source_type if project else "git") or "git"
        self.git_radio.setChecked(st == "git")
        self.local_radio.setChecked(st == "local")
        type_row = QHBoxLayout()
        type_row.addWidget(self.git_radio)
        type_row.addWidget(self.local_radio)
        form.addRow("Source", type_row)
        self.url = QLineEdit(project.url if project else "")
        self.branch = QLineEdit(project.branch if project else "main")
        self.docs_url = QLineEdit(project.docs_url or "" if project else "")
        self.local_path = QLineEdit(project.local_path or "" if project else "")
        self.local_path.setReadOnly(True)
        browse = QPushButton("Browse…")
        browse.clicked.connect(self._browse_local)
        local_row = QHBoxLayout()
        local_row.addWidget(self.local_path, 1)
        local_row.addWidget(browse)
        form.addRow("Name", self.name)
        form.addRow("URL / path", self.url)
        form.addRow("Branch", self.branch)
        form.addRow("Local folder", local_row)
        form.addRow("Docs URL", self.docs_url)
        self.git_radio.toggled.connect(self._on_source_type_changed)
        self._on_source_type_changed()
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        form.addRow(buttons)

    def _on_source_type_changed(self) -> None:
        git = self.git_radio.isChecked()
        self.branch.setEnabled(git)

    def _browse_local(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "Select STL folder")
        if path:
            self.local_path.setText(path)
            if not self.name.text().strip():
                self.name.setText(Path(path).name)
            if not self.url.text().strip():
                self.url.setText(f"file://{path}")

    def values(self) -> dict:
        source_type = "local" if self.local_radio.isChecked() else "git"
        return {
            "name": self.name.text().strip(),
            "url": self.url.text().strip(),
            "branch": self.branch.text().strip() or "main",
            "docs_url": self.docs_url.text().strip() or None,
            "source_type": source_type,
            "local_path": self.local_path.text().strip() or None,
        }


class ProjectLibrary(QWidget):
    projects_changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.addWidget(
            QLabel(
                "Sync repos, then use Import files to choose which STLs are included in builds "
                "(improves performance on large repositories)."
            )
        )
        self.table = QTableWidget(0, 7)
        self.table.setHorizontalHeaderLabels(
            ["Name", "URL", "Branch", "Local path", "STLs imported", "Last sync", "Commit"]
        )
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        layout.addWidget(self.table)
        self._sync_worker: SyncAllWorker | None = None
        self._sync_failures: list[str] = []

        row = QHBoxLayout()
        for text, slot in [
            ("Add", self._add),
            ("Edit", self._edit),
            ("Delete", self._delete),
            ("Import repos.txt", self._import_repos),
            ("Import files…", self._import_files),
            ("Sync selected", self._sync_selected),
            ("Sync all", self._sync_all),
        ]:
            btn = QPushButton(text)
            btn.clicked.connect(slot)
            row.addWidget(btn)
        layout.addLayout(row)
        self.refresh()

    def shutdown(self) -> None:
        if self._sync_worker and self._sync_worker.isRunning():
            self._sync_worker.cancel()
            self._sync_worker.wait(8000)
        self._sync_worker = None

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

    def refresh(self) -> None:
        with db_session() as session:
            projects = list_projects(session)
            self.table.setRowCount(len(projects))
            for i, p in enumerate(projects):
                self.table.setItem(i, 0, QTableWidgetItem(p.name))
                self.table.setItem(i, 1, QTableWidgetItem(p.url))
                self.table.setItem(i, 2, QTableWidgetItem(p.branch))
                self.table.setItem(i, 3, QTableWidgetItem(p.local_path or ""))
                self.table.setItem(i, 4, QTableWidgetItem(self._import_status_label(p)))
                sync = p.last_synced_at.isoformat() if p.last_synced_at else ""
                self.table.setItem(i, 5, QTableWidgetItem(sync))
                self.table.setItem(i, 6, QTableWidgetItem(p.last_commit_sha or ""))
                self.table.item(i, 0).setData(Qt.UserRole, p.id)

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
        return True

    def _import_files(self) -> None:
        pid = self._selected_id()
        if pid is None:
            QMessageBox.information(self, "Import files", "Select a project first.")
            return
        self._open_import_dialog(pid)

    def _add(self) -> None:
        dlg = ProjectDialog(parent=self)
        if dlg.exec() != QDialog.Accepted:
            return
        v = dlg.values()
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
            for k, val in dlg.values().items():
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

        def on_progress(i: int, total: int, name: str) -> None:
            progress.setMaximum(max(1, total))
            progress.setLabelText(f"Syncing {name} ({i}/{total})…")
            progress.setValue(i)
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

        def on_finished() -> None:
            progress.close()
            self._sync_worker = None
            self.refresh()
            self.projects_changed.emit()
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
                QMessageBox.information(self, "Sync all", all_done_message)

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
