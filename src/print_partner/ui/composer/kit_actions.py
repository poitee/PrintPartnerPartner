"""Kit lifecycle actions for ProfileComposer (wizard, layers, recompute, manage)."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QInputDialog,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QProgressDialog,
    QVBoxLayout,
)

from print_partner.core.profile_ops import (
    add_addon_project,
    delete_profile,
    duplicate_profile,
    recompute_profile,
    remove_layer,
    rename_profile,
    replace_layer_project,
    restore_profile_from_template,
    set_base_project,
    set_profile_order_number,
)
from print_partner.core.wizard_finish import load_wizard_state_from_profile
from print_partner.db.models import BuildProfile
from print_partner.db.session import (
    db_session,
    get_profile_parts,
    list_projects,
)
from print_partner.ui.build_wizard import BuildWizard
from print_partner.ui.recompute_worker import RecomputeWorker


class KitActionsMixin:
    """Mixin: profile CRUD, layers, recompute, build wizard."""

    def _new_build_wizard(self) -> None:
        wiz = BuildWizard(parent=self)
        wiz.build_finished.connect(self._on_build_wizard_finished)
        wiz.exec()

    def _duplicate_build_wizard(self) -> None:
        if self._current_profile_id is None:
            QMessageBox.information(self, "Duplicate build", "Select a profile to duplicate.")
            return
        with db_session() as session:
            state = load_wizard_state_from_profile(session, self._current_profile_id)
        state.mode = "new"
        state.profile_id = None
        state.profile_name = f"{state.profile_name} (copy)"
        wiz = BuildWizard(state, parent=self)
        wiz.build_finished.connect(self._on_build_wizard_finished)
        wiz.exec()

    def _on_build_wizard_finished(self, profile_id: int) -> None:
        self.refresh_profiles(select_profile_id=profile_id)
        self.profile_changed.emit()
        self._start_thumbnail_cache()

    def _new_profile(self) -> None:
        name, ok = QInputDialog.getText(self, "New profile", "Profile name:")
        if not ok or not name.strip():
            return
        with db_session() as session:
            from sqlalchemy import select

            if session.scalars(select(BuildProfile).where(BuildProfile.name == name.strip())).first():
                QMessageBox.warning(self, "Duplicate", "Profile already exists.")
                return
            bp = BuildProfile(name=name.strip())
            session.add(bp)
            session.flush()
            new_id = bp.id
        self.refresh_profiles(select_profile_id=new_id)

    def _set_base(self) -> None:
        if self._current_profile_id is None:
            return
        projects = self._pick_project("Select base project")
        if not projects:
            return
        with db_session() as session:
            set_base_project(session, self._current_profile_id, projects[0])
        self._recompute()

    def _add_addon(self) -> None:
        if self._current_profile_id is None:
            return
        projects = self._pick_project("Select addon project")
        if not projects:
            return
        with db_session() as session:
            add_addon_project(session, self._current_profile_id, projects[0])
        self._recompute()

    def _change_layer_project(self, layer_id: int) -> None:
        projects = self._pick_project("Select project for layer")
        if not projects:
            return
        with db_session() as session:
            replace_layer_project(session, layer_id, projects[0])
        self._recompute()

    def _remove_layer(self, layer_id: int) -> None:
        if self._current_profile_id is None:
            return
        try:
            with db_session() as session:
                remove_layer(session, layer_id)
                recompute_profile(session, self._current_profile_id)
        except ValueError as exc:
            QMessageBox.warning(self, "Remove layer", str(exc))
            return
        self._load_parts()

    def _pick_project(self, title: str) -> list[int]:
        with db_session() as session:
            projs = list_projects(session)
            if not projs:
                QMessageBox.information(self, title, "Add and sync projects first.")
                return []
            choices = [(p.id, p.name) for p in projs]
        dlg = QDialog(self)
        dlg.setWindowTitle(title)
        layout = QVBoxLayout(dlg)
        layout.addWidget(QLabel("Select a project:"))
        list_widget = QListWidget()
        for pid, proj_name in choices:
            item = QListWidgetItem(proj_name)
            item.setData(Qt.UserRole, pid)
            list_widget.addItem(item)
        if list_widget.count():
            list_widget.setCurrentRow(0)
        list_widget.setMinimumSize(320, 200)
        layout.addWidget(list_widget)
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(dlg.accept)
        buttons.rejected.connect(dlg.reject)
        layout.addWidget(buttons)
        if dlg.exec() != QDialog.Accepted:
            return []
        item = list_widget.currentItem()
        if item is None:
            return []
        pid = item.data(Qt.UserRole)
        if pid is None:
            return []
        return [int(pid)]

    def _recompute(self) -> None:
        if self._current_profile_id is None:
            return
        if self._recompute_worker and self._recompute_worker.isRunning():
            return
        progress = QProgressDialog("Recomputing profile…", "Cancel", 0, 0, self)
        progress.setWindowModality(Qt.WindowModal)
        progress.setMinimumDuration(0)
        progress.setLabelText("Scanning layers and merging parts…")
        profile_id = self._current_profile_id
        self._recompute_worker = RecomputeWorker(profile_id, parent=self)

        def on_progress(message: str) -> None:
            progress.setLabelText(message)
            if progress.wasCanceled() and self._recompute_worker:
                self._recompute_worker.cancel()

        def on_finished(result: dict) -> None:
            progress.close()
            self._recompute_worker = None
            if result.get("reason") == "cancelled":
                return
            if not result.get("merged"):
                reason = result.get("reason", "no_layers")
                if reason == "no_stls":
                    text = result.get("message") or (
                        "No STL files matched import rules.\n\n"
                        "Use Projects → Import files… for each repo."
                    )
                elif reason == "would_wipe":
                    text = result.get("message") or "Recompute would remove all parts."
                else:
                    text = (
                        "No layers to scan.\n\n"
                        "1. On Libraries: add repos and Sync selected.\n"
                        "2. Add base project via layers panel.\n"
                        "3. Then Recompute."
                    )
                QMessageBox.warning(self, "Recompute", text)
                return
            self._load_parts()
            self.profile_changed.emit()
            self.dismiss_recompute_banner()
            self._start_thumbnail_cache()
            from print_partner.ui.toast import show_toast

            show_toast(self, "Kit recomputed.")

        def on_error(message: str) -> None:
            progress.close()
            self._recompute_worker = None
            QMessageBox.critical(self, "Recompute failed", message)

        self._recompute_worker.progress.connect(on_progress)
        self._recompute_worker.finished_ok.connect(on_finished)
        self._recompute_worker.error.connect(on_error)
        self._recompute_worker.start()

    def _try_restore_wiped_profile(self) -> None:
        """If this profile was emptied but a '(copy)' sibling still has data, offer restore."""
        if self._current_profile_id is None:
            return
        with db_session() as session:
            profile = session.get(BuildProfile, self._current_profile_id)
            if not profile:
                return
            if get_profile_parts(session, self._current_profile_id):
                return
            from sqlalchemy import select

            candidates = list(
                session.scalars(
                    select(BuildProfile).where(
                        BuildProfile.id != profile.id,
                        BuildProfile.name.contains("(copy)"),
                    )
                ).all()
            )
            source = None
            best_count = 0
            for cand in candidates:
                n = len(get_profile_parts(session, cand.id))
                if n > best_count:
                    best_count = n
                    source = cand
            if not source or best_count == 0:
                return
            reply = QMessageBox.question(
                self,
                "Restore profile?",
                f"“{profile.name}” has no parts, but “{source.name}” still has "
                f"{best_count} parts with your settings.\n\n"
                "Restore your work from the copy into this profile?",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.Yes,
            )
            if reply != QMessageBox.Yes:
                return
            try:
                restored = restore_profile_from_template(session, profile.id, source.id)
            except ValueError as exc:
                QMessageBox.warning(self, "Restore failed", str(exc))
                return
        from print_partner.ui.toast import show_toast

        show_toast(self, f"Restored {restored} parts into “{profile.name}”.")
        self._load_parts()
        self.profile_changed.emit()

    def _save_order_number(self) -> None:
        if self._current_profile_id is None:
            return
        text = self.order_number_edit.text().strip() or None
        with db_session() as session:
            set_profile_order_number(session, self._current_profile_id, text)
        self.refresh_profiles(select_profile_id=self._current_profile_id)

    def _manage_rename(self) -> None:
        if self._current_profile_id is None:
            return
        with db_session() as session:
            profile = session.get(BuildProfile, self._current_profile_id)
            if not profile:
                return
            current = profile.name
        name, ok = QInputDialog.getText(self, "Rename profile", "Profile name:", text=current)
        if not ok or not name.strip():
            return
        try:
            with db_session() as session:
                rename_profile(session, self._current_profile_id, name.strip())
        except ValueError as exc:
            QMessageBox.warning(self, "Rename", str(exc))
            return
        self.refresh_profiles(select_profile_id=self._current_profile_id)

    def _manage_delete(self) -> None:
        if self._current_profile_id is None:
            return
        name = self.profile_combo.currentText()
        reply = QMessageBox.question(
            self,
            "Delete profile",
            f"Delete profile “{name}” and all its parts?",
            QMessageBox.Yes | QMessageBox.No,
        )
        if reply != QMessageBox.Yes:
            return
        deleted_id = self._current_profile_id
        with db_session() as session:
            delete_profile(session, deleted_id)
        self.refresh_profiles()

    def _manage_duplicate_db(self) -> None:
        if self._current_profile_id is None:
            return
        with db_session() as session:
            profile = session.get(BuildProfile, self._current_profile_id)
            default = f"{profile.name} (copy)" if profile else "Copy"
        name, ok = QInputDialog.getText(self, "Duplicate profile", "New profile name:", text=default)
        if not ok or not name.strip():
            return
        try:
            with db_session() as session:
                new_id = duplicate_profile(session, self._current_profile_id, name.strip())
        except ValueError as exc:
            QMessageBox.warning(self, "Duplicate", str(exc))
            return
        self.refresh_profiles(select_profile_id=new_id)

    def _manage_edit_wizard(self) -> None:
        if self._current_profile_id is None:
            return
        with db_session() as session:
            state = load_wizard_state_from_profile(session, self._current_profile_id)
        state.mode = "load"
        wiz = BuildWizard(state, parent=self)
        wiz.build_finished.connect(self._on_build_wizard_finished)
        wiz.exec()
