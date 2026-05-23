"""AI assistant integration for ProfileComposer."""

from __future__ import annotations

from print_partner.core.ai_context import build_kit_context, context_snapshot
from print_partner.core.ai_executor import apply_actions
from print_partner.db.session import db_session
from print_partner.ui.ai_settings_dialog import AiSettingsDialog


class AiIntegrationMixin:
    """Mixin: AI settings, context, and action application."""

    def _show_ai_settings(self) -> None:
        dlg = AiSettingsDialog(self)
        if dlg.exec():
            self.ai_panel.refresh_enabled_state()

    def _ai_snapshot(self) -> str:
        if self._current_profile_id is None:
            return "No profile selected"
        return context_snapshot(self._load_part_dicts_for_summary())

    def _build_ai_context(self, user_question: str | None = None) -> str:
        if self._current_profile_id is None:
            return ""
        part_dicts = self._load_part_dicts_for_summary()
        screen = self._kit_sub_mode if self._top_mode == "kit" else "checkoff"
        top_tab = "kit" if self._top_mode == "kit" else "checkoff"
        with db_session() as session:
            return build_kit_context(
                session,
                self._current_profile_id,
                part_dicts,
                selected_part_id=self._last_selected_part_id,
                user_question=user_question,
                screen=screen,
                top_tab=top_tab,
            )

    def _on_ai_apply_actions(self, actions) -> None:
        if not actions or self._current_profile_id is None:
            return
        navigate_target = None
        with db_session() as session:
            result = apply_actions(session, self._current_profile_id, actions)
            navigate_target = result.navigate_target
        if navigate_target:
            self.navigate_requested.emit(navigate_target)
        self._load_parts()
        self.ai_panel.refresh_context_snapshot()
        if self._is_kit_compose:
            self._schedule_thumbnail_cache()
