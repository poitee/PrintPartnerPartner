"""User printer fleet: bed size and loaded filament slots."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from importlib import resources
from typing import Any

from print_partner.db.session import get_setting_value, set_setting_value

_FLEET_KEY = "printer.fleet"


@dataclass
class LoadedFilament:
    slot: int
    filament_color_id: str | None = None
    label: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> LoadedFilament:
        return cls(
            slot=int(data.get("slot", 1)),
            filament_color_id=data.get("filament_color_id"),
            label=str(data.get("label", "")),
        )


@dataclass
class PrinterMachine:
    id: str
    name: str
    bed_width_mm: float
    bed_depth_mm: float
    bed_height_mm: float | None = 250.0
    margin_mm: float = 4.0
    max_filament_slots: int = 1
    loaded_filaments: list[LoadedFilament] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "bed_width_mm": self.bed_width_mm,
            "bed_depth_mm": self.bed_depth_mm,
            "bed_height_mm": self.bed_height_mm,
            "margin_mm": self.margin_mm,
            "max_filament_slots": self.max_filament_slots,
            "loaded_filaments": [lf.to_dict() for lf in self.loaded_filaments],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PrinterMachine:
        loaded = [LoadedFilament.from_dict(x) for x in (data.get("loaded_filaments") or [])]
        return cls(
            id=str(data["id"]),
            name=str(data.get("name", "Printer")),
            bed_width_mm=float(data.get("bed_width_mm", 250)),
            bed_depth_mm=float(data.get("bed_depth_mm", 210)),
            bed_height_mm=(
                float(data["bed_height_mm"]) if data.get("bed_height_mm") is not None else None
            ),
            margin_mm=float(data.get("margin_mm", 4.0)),
            max_filament_slots=int(data.get("max_filament_slots", 1)),
            loaded_filaments=loaded,
        )

    def ensure_slots(self) -> None:
        n = max(1, min(4, self.max_filament_slots))
        self.max_filament_slots = n
        by_slot = {lf.slot: lf for lf in self.loaded_filaments}
        self.loaded_filaments = [
            by_slot.get(i) or LoadedFilament(slot=i) for i in range(1, n + 1)
        ]

    def loaded_filament_ids(self) -> set[str]:
        return {lf.filament_color_id for lf in self.loaded_filaments if lf.filament_color_id}


def load_printer_presets() -> list[PrinterMachine]:
    raw = (
        resources.files("print_partner.data")
        .joinpath("printer_presets.json")
        .read_text(encoding="utf-8")
    )
    fleet: list[PrinterMachine] = []
    for item in json.loads(raw):
        m = PrinterMachine.from_dict(item)
        m.ensure_slots()
        fleet.append(m)
    return fleet


def load_fleet() -> list[PrinterMachine]:
    raw = get_setting_value(_FLEET_KEY)
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except json.JSONDecodeError:
        return []
    fleet = [PrinterMachine.from_dict(x) for x in items]
    for m in fleet:
        m.ensure_slots()
    return fleet


def save_fleet(fleet: list[PrinterMachine]) -> None:
    for m in fleet:
        m.ensure_slots()
    set_setting_value(_FLEET_KEY, json.dumps([m.to_dict() for m in fleet], indent=2))


def new_machine_from_preset(preset: PrinterMachine, name: str | None = None) -> PrinterMachine:
    return PrinterMachine(
        id=f"printer-{uuid.uuid4().hex[:10]}",
        name=name or preset.name,
        bed_width_mm=preset.bed_width_mm,
        bed_depth_mm=preset.bed_depth_mm,
        bed_height_mm=preset.bed_height_mm,
        margin_mm=preset.margin_mm,
        max_filament_slots=preset.max_filament_slots,
        loaded_filaments=[LoadedFilament(slot=i) for i in range(1, preset.max_filament_slots + 1)],
    )


def get_machine(fleet: list[PrinterMachine], machine_id: str) -> PrinterMachine | None:
    for m in fleet:
        if m.id == machine_id:
            return m
    return None
