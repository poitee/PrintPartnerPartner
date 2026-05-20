"""New build wizard — guided base, curation, addons, and save."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QShowEvent
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QRadioButton,
    QVBoxLayout,
    QWidget,
    QWizard,
    QWizardPage,
)

from print_partner.core.import_rules import import_rules_for_project, serialize_import_rules
from print_partner.core.project_import import register_local_project_path, sync_git_project
from print_partner.core.scanner import scan_repo
from print_partner.core.wizard_finish import finish_wizard_build, load_wizard_state_from_profile
from print_partner.core.wizard_reference import reference_layers_for_state
from print_partner.core.wizard_state import WizardState
from print_partner.db.models import Project
from print_partner.db.session import db_session, list_profiles, list_projects
from print_partner.ui.parts_curation_widget import PartsCurationWidget

class BuildWizard(QWizard):
    build_finished = Signal(int)

    PAGE_SETUP = 0
    PAGE_BASE_SOURCE = 1
    PAGE_BASE_PARTS = 2
    PAGE_ADDON_LOOP = 3
    PAGE_ADDON_SOURCE = 4
    PAGE_ADDON_PARTS = 5
    PAGE_REVIEW = 6

    def __init__(self, state: WizardState | None = None, parent=None):
        super().__init__(parent)
        self.state = state or WizardState()
        self.setWindowTitle("New build")
        self.setWizardStyle(QWizard.ModernStyle)
        self.setOption(QWizard.WizardOption.IndependentPages, True)
        self.setMinimumSize(720, 640)
        self._goto_addon_source = False

        self.addPage(BuildSetupPage(self.state))
        self.addPage(BaseSourcePage(self.state))
        self.addPage(BasePartsPage(self.state))
        self.addPage(AddonLoopPage(self.state))
        self.addPage(AddonSourcePage(self.state))
        self.addPage(AddonPartsPage(self.state))
        self.addPage(ReviewPage(self.state))

        # Re-apply after all pages exist (guards against style/options reset).
        self.setOption(QWizard.WizardOption.IndependentPages, True)
        self.finished.connect(self._on_finished)

    def pageIds(self) -> list[int]:
        return [
            self.PAGE_SETUP,
            self.PAGE_BASE_SOURCE,
            self.PAGE_BASE_PARTS,
            self.PAGE_ADDON_LOOP,
            self.PAGE_ADDON_SOURCE,
            self.PAGE_ADDON_PARTS,
            self.PAGE_REVIEW,
        ]

    def nextId(self) -> int:
        current = self.currentId()
        nxt = -1
        if current == self.PAGE_SETUP:
            if self.state.mode == "load" and self.state.profile_id:
                nxt = self.PAGE_REVIEW
            else:
                nxt = self.PAGE_BASE_SOURCE
        elif current == self.PAGE_BASE_SOURCE:
            nxt = self.PAGE_BASE_PARTS
        elif current == self.PAGE_BASE_PARTS:
            nxt = self.PAGE_ADDON_LOOP
        elif current == self.PAGE_ADDON_LOOP:
            if self._goto_addon_source:
                self._goto_addon_source = False
                nxt = self.PAGE_ADDON_SOURCE
            else:
                nxt = self.PAGE_REVIEW
        elif current == self.PAGE_ADDON_SOURCE:
            nxt = self.PAGE_ADDON_PARTS
        elif current == self.PAGE_ADDON_PARTS:
            # Wizard Next finishes addons (go to review). Avoid 5→3 forward revisit
            # which triggers Qt "Page already met" via C++ QWizard::next().
            nxt = self.PAGE_REVIEW
        return nxt

    def next(self) -> None:
        """Navigate without Qt sequential 'Page already met' guard on cyclic addon flow."""
        page = self.currentPage()
        if page is None or not page.validatePage():
            return
        next_id = self.nextId()
        if next_id < 0:
            super().next()
            return
        self.setOption(QWizard.WizardOption.IndependentPages, True)
        self.setCurrentId(next_id)

    def _on_finished(self, result: int) -> None:
        if result != QWizard.Accepted:
            return
        try:
            with db_session() as session:
                profile_id = finish_wizard_build(session, self.state)
            self.build_finished.emit(profile_id)
        except Exception as exc:
            QMessageBox.critical(self, "Save build failed", str(exc))


class BuildSetupPage(QWizardPage):
    def __init__(self, state: WizardState):
        super().__init__()
        self.state = state
        self.setTitle("Build setup")
        self.setSubTitle("Name your build or load a saved build to edit.")

        layout = QVBoxLayout(self)
        form = QFormLayout()
        self.name_edit = QLineEdit(state.profile_name)
        form.addRow("Build name", self.name_edit)

        self.mode_new = QRadioButton("New build")
        self.mode_load = QRadioButton("Load saved build")
        self.mode_new.setChecked(state.mode == "new")
        self.mode_load.setChecked(state.mode == "load")
        mode_row = QHBoxLayout()
        mode_row.addWidget(self.mode_new)
        mode_row.addWidget(self.mode_load)
        layout.addLayout(form)
        layout.addLayout(mode_row)

        self.profile_combo = QComboBox()
        self.profile_combo.setEnabled(self.mode_load.isChecked())
        self._refresh_profiles()
        layout.addWidget(QLabel("Saved build:"))
        layout.addWidget(self.profile_combo)

        self.mode_new.toggled.connect(self._on_mode_changed)
        self.mode_load.toggled.connect(self._on_mode_changed)
        self.profile_combo.currentIndexChanged.connect(self._on_profile_picked)
        self.registerField("buildName*", self.name_edit)

    def _refresh_profiles(self) -> None:
        self.profile_combo.clear()
        with db_session() as session:
            for p in list_profiles(session):
                self.profile_combo.addItem(p.name, p.id)

    def _on_mode_changed(self) -> None:
        load = self.mode_load.isChecked()
        self.profile_combo.setEnabled(load)
        self.state.mode = "load" if load else "new"

    def _on_profile_picked(self) -> None:
        if not self.mode_load.isChecked():
            return
        pid = self.profile_combo.currentData()
        if pid is None:
            return
        with db_session() as session:
            loaded = load_wizard_state_from_profile(session, int(pid))
        self.state.mode = loaded.mode
        self.state.profile_id = loaded.profile_id
        self.state.profile_name = loaded.profile_name
        self.state.base_project_id = loaded.base_project_id
        self.state.base_included = loaded.base_included
        self.state.addons = loaded.addons
        self.name_edit.setText(loaded.profile_name)

    def validatePage(self) -> bool:
        self.state.profile_name = self.name_edit.text().strip()
        if not self.state.profile_name:
            QMessageBox.warning(self, "Validation", "Enter a build name.")
            return False
        if self.mode_load.isChecked() and self.profile_combo.currentData() is None:
            QMessageBox.warning(self, "Validation", "Select a saved build or choose New build.")
            return False
        return True


class ProjectSourceWidget(QWidget):
    """Git or local folder source picker."""

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        type_row = QHBoxLayout()
        self.git_radio = QRadioButton("Git repository")
        self.local_radio = QRadioButton("Local folder")
        self.git_radio.setChecked(True)
        type_row.addWidget(self.git_radio)
        type_row.addWidget(self.local_radio)
        layout.addLayout(type_row)

        self.stack_git = QWidget()
        git_form = QFormLayout(self.stack_git)
        self.existing_combo = QComboBox()
        self.new_name = QLineEdit()
        self.new_url = QLineEdit()
        self.new_branch = QLineEdit("main")
        self.btn_sync = QPushButton("Sync now")
        git_form.addRow("Existing project", self.existing_combo)
        git_form.addRow("Or new name", self.new_name)
        git_form.addRow("Git URL", self.new_url)
        git_form.addRow("Branch", self.new_branch)
        git_form.addRow("", self.btn_sync)
        layout.addWidget(self.stack_git)

        local_row = QHBoxLayout()
        self.local_path = QLineEdit()
        self.local_path.setReadOnly(True)
        self.btn_browse = QPushButton("Browse…")
        local_row.addWidget(self.local_path, 1)
        local_row.addWidget(self.btn_browse)
        self.local_name = QLineEdit()
        local_form = QFormLayout()
        local_form.addRow("Folder", local_row)
        local_form.addRow("Project name", self.local_name)
        self.stack_local = QWidget()
        self.stack_local.setLayout(local_form)
        layout.addWidget(self.stack_local)
        self.stack_local.hide()

        self.git_radio.toggled.connect(self._on_type_changed)
        self.local_radio.toggled.connect(self._on_type_changed)
        self.btn_browse.clicked.connect(self._browse_local)
        self.btn_sync.clicked.connect(self._sync_git)
        self._refresh_projects()

    def _on_type_changed(self) -> None:
        git = self.git_radio.isChecked()
        self.stack_git.setVisible(git)
        self.stack_local.setVisible(not git)

    def _refresh_projects(self) -> None:
        self.existing_combo.clear()
        self.existing_combo.addItem("(none)", None)
        with db_session() as session:
            for p in list_projects(session):
                hint = "synced" if p.local_path else "not synced"
                self.existing_combo.addItem(f"{p.name} ({hint})", p.id)

    def _browse_local(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "Select STL folder")
        if path:
            self.local_path.setText(path)
            if not self.local_name.text().strip():
                self.local_name.setText(Path(path).name)

    def _sync_git(self) -> None:
        QMessageBox.information(self, "Sync", "Click Next to sync and continue.")

    def resolve_project_id(self) -> int:
        if self.local_radio.isChecked():
            return self._resolve_local()
        return self._resolve_git()

    def _resolve_local(self) -> int:
        path = self.local_path.text().strip()
        name = self.local_name.text().strip() or Path(path).name
        if not path or not name:
            raise ValueError("Choose a folder and project name.")
        result = register_local_project_path(name, Path(path))
        with db_session() as session:
            from sqlalchemy import select

            proj = session.scalars(select(Project).where(Project.name == name)).first()
            if proj:
                proj.source_type = "local"
                proj.url = f"file://{path}"
                proj.local_path = str(result.local_path)
                proj.last_synced_at = result.last_synced_at
                proj.branch = "main"
            else:
                proj = Project(
                    name=name,
                    url=f"file://{path}",
                    source_type="local",
                    branch="main",
                    local_path=str(result.local_path),
                    last_synced_at=result.last_synced_at,
                )
                session.add(proj)
            session.flush()
            return proj.id

    def _resolve_git(self) -> int:
        existing_id = self.existing_combo.currentData()
        if existing_id is not None:
            name = self.existing_combo.currentText().split(" (")[0]
            with db_session() as session:
                proj = session.get(Project, int(existing_id))
                if not proj:
                    raise ValueError("Project not found")
                if not proj.local_path:
                    sync = sync_git_project(proj.name, proj.url, proj.branch or "main")
                    proj.local_path = str(sync.local_path)
                    proj.last_synced_at = sync.last_synced_at
                    proj.last_commit_sha = sync.commit_sha
                rules = import_rules_for_project(proj.imported_paths)
                if rules is not None and len(rules) == 0:
                    raise ValueError(
                        f"No STL files imported for project “{proj.name}”. "
                        "On the Projects tab, sync the repo and use Import files to choose STLs."
                    )
                return proj.id

        name = self.new_name.text().strip()
        url = self.new_url.text().strip()
        branch = self.new_branch.text().strip() or "main"
        if not name or not url:
            raise ValueError("Enter project name and Git URL, or pick an existing project.")
        sync = sync_git_project(name, url, branch)
        with db_session() as session:
            from sqlalchemy import select

            proj = session.scalars(select(Project).where(Project.name == name)).first()
            if proj:
                proj.url = url
                proj.branch = branch
                proj.source_type = "git"
                proj.local_path = str(sync.local_path)
                proj.last_synced_at = sync.last_synced_at
                proj.last_commit_sha = sync.commit_sha
            else:
                proj = Project(
                    name=name,
                    url=url,
                    branch=branch,
                    source_type="git",
                    local_path=str(sync.local_path),
                    last_synced_at=sync.last_synced_at,
                    last_commit_sha=sync.commit_sha,
                )
                session.add(proj)
            session.flush()
            rules = import_rules_for_project(proj.imported_paths)
            if rules is not None and len(rules) == 0:
                raise ValueError(
                    f"No STL files imported for project “{name}”. "
                    "On the Projects tab, open the repo and use Import files to choose STLs."
                )
            return proj.id


class BaseSourcePage(QWizardPage):
    def __init__(self, state: WizardState):
        super().__init__()
        self.state = state
        self.setTitle("Base repository")
        self.setSubTitle("Add the main kit repo (Git) or point at a local folder of STLs.")
        layout = QVBoxLayout(self)
        self.source = ProjectSourceWidget()
        layout.addWidget(self.source)

    def initializePage(self) -> None:
        self.source._refresh_projects()

    def validatePage(self) -> bool:
        try:
            self.state.base_project_id = self.source.resolve_project_id()
            return True
        except Exception as exc:
            QMessageBox.critical(self, "Base source", str(exc))
            return False


class BasePartsPage(QWizardPage):
    def __init__(self, state: WizardState):
        super().__init__()
        self.state = state
        self.setTitle("Base parts")
        self.setSubTitle("Choose which base parts to print.")
        layout = QVBoxLayout(self)
        self.curation = PartsCurationWidget()
        layout.addWidget(self.curation)

    def initializePage(self) -> None:
        if self.state.base_project_id is None:
            return
        repo: Path | None = None
        rules = None
        with db_session() as session:
            proj = session.get(Project, self.state.base_project_id)
            if not proj or not proj.local_path:
                return
            repo = Path(proj.local_path)
            rules = import_rules_for_project(proj.imported_paths)
            parts = scan_repo(repo, "base", import_rules=rules)
        if not parts:
            if rules is not None and len(rules) == 0:
                QMessageBox.warning(
                    self,
                    "No imported files",
                    "No STL files are imported for this project.\n\n"
                    "Go to Projects → select the repo → Import files… to choose which STLs to include.",
                )
            return
        base_included = (
            set(self.state.base_included) if self.state.base_included else None
        )
        self.curation.load_parts(
            parts,
            base_included,
            reference_layers=None,
            repo_path=repo or Path("."),
        )

    def validatePage(self) -> bool:
        self.state.base_included = self.curation.included_match_keys()
        if not self.state.base_included:
            QMessageBox.warning(self, "Parts", "Include at least one base part.")
            return False
        return True


class AddonLoopPage(QWizardPage):
    def __init__(self, state: WizardState):
        super().__init__()
        self.state = state
        self.setTitle("Additional repositories")
        self.setSubTitle("Add addon repos (LDO, West3D, etc.) or finish the build.")
        layout = QVBoxLayout(self)
        self.summary = QLabel("")
        self.summary.setWordWrap(True)
        layout.addWidget(self.summary)

        row = QHBoxLayout()
        self.btn_add = QPushButton("Add another addon")
        self.btn_add.clicked.connect(self._request_addon)
        self.btn_done = QPushButton("Done with addons")
        self.btn_done.clicked.connect(self._done_addons)
        row.addWidget(self.btn_add)
        row.addWidget(self.btn_done)
        layout.addLayout(row)

    def initializePage(self) -> None:
        lines = []
        if self.state.base_project_id:
            lines.append(f"Base project id: {self.state.base_project_id}")
        for i, layer in enumerate(self.state.addons, 1):
            lines.append(f"  Addon {i}: project #{layer.project_id} ({len(layer.included_match_keys)} parts)")
        self.summary.setText("\n".join(lines) if lines else "No addons yet.")

    def _request_addon(self) -> None:
        wizard = self.wizard()
        if isinstance(wizard, BuildWizard):
            wizard.state.clear_draft_addon()
            wizard.setOption(QWizard.WizardOption.IndependentPages, True)
            wizard.setCurrentId(wizard.PAGE_ADDON_SOURCE)

    def _done_addons(self) -> None:
        wizard = self.wizard()
        if isinstance(wizard, BuildWizard):
            wizard.setOption(QWizard.WizardOption.IndependentPages, True)
            wizard.setCurrentId(wizard.PAGE_REVIEW)

    def validatePage(self) -> bool:
        return True


class AddonSourcePage(QWizardPage):
    def __init__(self, state: WizardState):
        super().__init__()
        self.state = state
        self.setTitle("Addon repository")
        self.setSubTitle("Add an addon repo the same way as the base.")
        layout = QVBoxLayout(self)
        self.source = ProjectSourceWidget()
        layout.addWidget(self.source)

    def initializePage(self) -> None:
        self.source._refresh_projects()

    def validatePage(self) -> bool:
        try:
            self.state.draft_addon_project_id = self.source.resolve_project_id()
            return True
        except Exception as exc:
            QMessageBox.critical(self, "Addon source", str(exc))
            return False


class AddonPartsPage(QWizardPage):
    def __init__(self, state: WizardState):
        super().__init__()
        self.state = state
        self.setTitle("Addon parts")
        self.setSubTitle(
            "Choose which addon parts to print. Use the buttons below to add more addons or continue."
        )
        layout = QVBoxLayout(self)
        self.curation = PartsCurationWidget()
        layout.addWidget(self.curation, 1)

        nav = QHBoxLayout()
        self.btn_add_another = QPushButton("Add another addon")
        self.btn_add_another.clicked.connect(self._add_another_addon)
        self.btn_back_loop = QPushButton("Back to addon list")
        self.btn_back_loop.clicked.connect(self._back_to_addon_list)
        self.btn_done = QPushButton("Done with addons")
        self.btn_done.clicked.connect(self._done_with_addons)
        nav.addWidget(self.btn_add_another)
        nav.addWidget(self.btn_back_loop)
        nav.addWidget(self.btn_done)
        layout.addLayout(nav)

    def _commit_draft_addon(self) -> bool:
        pid = self.state.draft_addon_project_id
        if pid is None:
            return True
        included = self.curation.included_match_keys()
        self.state.draft_addon_included = included
        if not included:
            QMessageBox.warning(self, "Parts", "Include at least one addon part, or go back.")
            return False
        with db_session() as session:
            proj = session.get(Project, pid)
            label = f"addon:{proj.name}" if proj else "addon"
        self.state.commit_draft_addon(label)
        return True

    def _wizard(self) -> BuildWizard | None:
        wiz = self.wizard()
        return wiz if isinstance(wiz, BuildWizard) else None

    def _add_another_addon(self) -> None:
        if not self._commit_draft_addon():
            return
        wiz = self._wizard()
        if wiz:
            wiz.state.clear_draft_addon()
            wiz.setOption(QWizard.WizardOption.IndependentPages, True)
            wiz.setCurrentId(wiz.PAGE_ADDON_SOURCE)

    def _back_to_addon_list(self) -> None:
        if not self._commit_draft_addon():
            return
        wiz = self._wizard()
        if wiz:
            wiz.state.clear_draft_addon()
            wiz.setOption(QWizard.WizardOption.IndependentPages, True)
            wiz.setCurrentId(wiz.PAGE_ADDON_LOOP)

    def _done_with_addons(self) -> None:
        if not self._commit_draft_addon():
            return
        wiz = self._wizard()
        if wiz:
            wiz.setOption(QWizard.WizardOption.IndependentPages, True)
            wiz.setCurrentId(wiz.PAGE_REVIEW)

    def _reload_addon_parts(self) -> None:
        """Load parts for draft_addon_project_id (Qt may skip initializePage on revisit)."""
        pid = self.state.draft_addon_project_id
        if pid is None:
            self.curation.load_parts([], set())
            return
        with db_session() as session:
            proj = session.get(Project, pid)
            if not proj or not proj.local_path:
                self.curation.load_parts([], set())
                return
            rules = import_rules_for_project(proj.imported_paths)
            parts = scan_repo(Path(proj.local_path), "addon", import_rules=rules)
            if not parts and rules is not None and len(rules) == 0:
                QMessageBox.warning(
                    self,
                    "No imported files",
                    f"No STL files are imported for addon project “{proj.name}”.\n\n"
                    "Use Projects → Import files… first.",
                )
                self.curation.load_parts([], set())
                return
            refs = reference_layers_for_state(session, self.state)
            extra_readme: list[Path] = []
            base_proj = session.get(Project, self.state.base_project_id) if self.state.base_project_id else None
            if base_proj and base_proj.local_path:
                extra_readme.append(Path(base_proj.local_path))
            repo = Path(proj.local_path)
        addon_included = (
            set(self.state.draft_addon_included) if self.state.draft_addon_included else None
        )
        self.curation.load_parts(
            parts,
            addon_included,
            reference_layers=refs,
            repo_path=repo,
            extra_readme_paths=extra_readme,
        )

    def initializePage(self) -> None:
        self._reload_addon_parts()

    def showEvent(self, event: QShowEvent) -> None:
        super().showEvent(event)
        self._reload_addon_parts()

    def validatePage(self) -> bool:
        return self._commit_draft_addon()


class ReviewPage(QWizardPage):
    def __init__(self, state: WizardState):
        super().__init__()
        self.state = state
        self.setTitle("Review")
        self.setSubTitle("Confirm your build, then click Finish to save.")
        layout = QVBoxLayout(self)
        self.summary = QLabel("")
        self.summary.setWordWrap(True)
        layout.addWidget(self.summary)

    def initializePage(self) -> None:
        lines = [f"Build: {self.state.profile_name}", ""]
        if self.state.base_project_id:
            with db_session() as session:
                proj = session.get(Project, self.state.base_project_id)
                name = proj.name if proj else "?"
            lines.append(f"Base: {name} — {len(self.state.base_included)} parts included")
        for i, layer in enumerate(self.state.addons, 1):
            with db_session() as session:
                proj = session.get(Project, layer.project_id)
                name = proj.name if proj else "?"
            lines.append(f"Addon {i}: {name} — {len(layer.included_match_keys)} parts included")
        self.summary.setText("\n".join(lines))


def run_build_wizard(parent=None, state: WizardState | None = None) -> int | None:
    """Run wizard modally; return profile_id if accepted else None."""
    wiz = BuildWizard(state, parent)
    profile_id: list[int | None] = [None]

    def on_done(pid: int) -> None:
        profile_id[0] = pid

    wiz.build_finished.connect(on_done)
    if wiz.exec() == QWizard.Accepted:
        return profile_id[0]
    return None
