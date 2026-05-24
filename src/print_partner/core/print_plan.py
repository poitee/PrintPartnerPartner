"""Per-kit print plan: which printers are active for export."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from print_partner.core.plate_plan import KitPlateLayout
from print_partner.db.session import get_setting_value, set_setting_value


def _plan_key(profile_id: int) -> str:
    return f"print_plan:{profile_id}"


@dataclass
class KitPrintPlan:
    enabled_printer_ids: list[str] | None = None
    plate_layout: KitPlateLayout | None = None

    def __post_init__(self) -> None:
        if self.enabled_printer_ids is None:
            self.enabled_printer_ids = []

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"enabled_printer_ids": list(self.enabled_printer_ids or [])}
        if self.plate_layout is not None:
            out["plate_layout"] = self.plate_layout.to_dict()
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> KitPrintPlan:
        layout_raw = data.get("plate_layout")
        layout = (
            KitPlateLayout.from_dict(layout_raw)
            if isinstance(layout_raw, dict)
            else None
        )
        return cls(
            enabled_printer_ids=list(data.get("enabled_printer_ids") or []),
            plate_layout=layout,
        )


def load_kit_print_plan(profile_id: int) -> KitPrintPlan:
    raw = get_setting_value(_plan_key(profile_id))
    if not raw:
        return KitPrintPlan()
    try:
        return KitPrintPlan.from_dict(json.loads(raw))
    except json.JSONDecodeError:
        return KitPrintPlan()


def save_kit_print_plan(profile_id: int, plan: KitPrintPlan) -> None:
    set_setting_value(_plan_key(profile_id), json.dumps(plan.to_dict(), indent=2))
