"""User-defined filament names and colors (local library + sharing)."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from print_partner.config import settings
from print_partner.core.ambrosia_catalog import AmbrosiaColor
from print_partner.core.mesh_color import normalize_mesh_hex

CUSTOM_PREFIX = "custom:"
LIBRARY_FORMAT = "print-partner-custom-filaments"
LIBRARY_VERSION = 1


@dataclass
class CustomFilament:
    id: str
    display_name: str
    hex: str
    product_line: str = "Custom"
    notes: str = ""
    created_at: str = ""

    @property
    def color_id(self) -> str:
        """Stable id stored on parts (custom:{id})."""
        bare = self.id.removeprefix(CUSTOM_PREFIX)
        return f"{CUSTOM_PREFIX}{bare}"

    @property
    def combo_label(self) -> str:
        return f"{self.product_line} · {self.display_name}"

    def to_catalog_color(self) -> AmbrosiaColor:
        hex_val = normalize_mesh_hex(self.hex) or "#888888"
        return AmbrosiaColor(
            id=self.color_id,
            display_name=self.display_name.strip() or "Unnamed",
            product_line=(self.product_line or "Custom").strip() or "Custom",
            shopify_product_id=0,
            shopify_variant_id=0,
            swatch_url="",
            hex=hex_val,
        )


def custom_filaments_path() -> Path:
    settings.ensure_dirs()
    return settings.data_dir / "custom_filaments.json"


def _new_bare_id() -> str:
    return uuid.uuid4().hex[:12]


def _normalize_entry(raw: dict[str, Any]) -> CustomFilament | None:
    name = (raw.get("display_name") or "").strip()
    hex_val = normalize_mesh_hex(raw.get("hex"))
    if not name or not hex_val:
        return None
    bare = (raw.get("id") or _new_bare_id()).strip().removeprefix(CUSTOM_PREFIX)
    if not bare:
        bare = _new_bare_id()
    created = (raw.get("created_at") or "").strip()
    if not created:
        created = datetime.now(timezone.utc).isoformat()
    return CustomFilament(
        id=bare,
        display_name=name,
        hex=hex_val,
        product_line=(raw.get("product_line") or "Custom").strip() or "Custom",
        notes=(raw.get("notes") or "").strip(),
        created_at=created,
    )


def load_custom_filaments() -> list[CustomFilament]:
    path = custom_filaments_path()
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    items = data.get("filaments") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    out: list[CustomFilament] = []
    for raw in items:
        if isinstance(raw, dict):
            entry = _normalize_entry(raw)
            if entry:
                out.append(entry)
    return sorted(out, key=lambda c: c.combo_label.lower())


def save_custom_filaments(filaments: list[CustomFilament]) -> None:
    path = custom_filaments_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": LIBRARY_VERSION,
        "filaments": [
            {
                "id": f.id,
                "display_name": f.display_name,
                "hex": f.hex,
                "product_line": f.product_line,
                "notes": f.notes,
                "created_at": f.created_at,
            }
            for f in filaments
        ],
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def custom_filaments_as_catalog() -> list[AmbrosiaColor]:
    return [f.to_catalog_color() for f in load_custom_filaments()]


def get_custom_color_by_id(color_id: str | None) -> AmbrosiaColor | None:
    if not color_id or not str(color_id).startswith(CUSTOM_PREFIX):
        return None
    bare = str(color_id).removeprefix(CUSTOM_PREFIX)
    for entry in load_custom_filaments():
        if entry.id == bare or entry.color_id == color_id:
            return entry.to_catalog_color()
    return None


def merged_filament_by_id() -> dict[str, AmbrosiaColor]:
    out = load_catalog().by_id()
    for color in custom_filaments_as_catalog():
        out[color.id] = color
    return out


def add_custom_filament(
    display_name: str,
    hex_color: str,
    *,
    product_line: str = "Custom",
    notes: str = "",
) -> CustomFilament:
    normalized = normalize_mesh_hex(hex_color)
    if not normalized:
        raise ValueError("Invalid color hex")
    name = display_name.strip()
    if not name:
        raise ValueError("Name is required")
    entry = CustomFilament(
        id=_new_bare_id(),
        display_name=name,
        hex=normalized,
        product_line=product_line.strip() or "Custom",
        notes=notes.strip(),
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    items = load_custom_filaments()
    items.append(entry)
    save_custom_filaments(items)
    return entry


def update_custom_filament(
    color_id: str,
    *,
    display_name: str | None = None,
    hex_color: str | None = None,
    product_line: str | None = None,
    notes: str | None = None,
) -> CustomFilament:
    bare = color_id.removeprefix(CUSTOM_PREFIX)
    items = load_custom_filaments()
    for idx, entry in enumerate(items):
        if entry.id != bare:
            continue
        name = display_name.strip() if display_name is not None else entry.display_name
        if not name:
            raise ValueError("Name is required")
        hex_val = entry.hex
        if hex_color is not None:
            normalized = normalize_mesh_hex(hex_color)
            if not normalized:
                raise ValueError("Invalid color hex")
            hex_val = normalized
        updated = CustomFilament(
            id=entry.id,
            display_name=name,
            hex=hex_val,
            product_line=(
                product_line.strip() if product_line is not None else entry.product_line
            )
            or "Custom",
            notes=notes if notes is not None else entry.notes,
            created_at=entry.created_at,
        )
        items[idx] = updated
        save_custom_filaments(items)
        return updated
    raise KeyError(f"Custom filament not found: {color_id}")


def delete_custom_filament(color_id: str) -> None:
    bare = color_id.removeprefix(CUSTOM_PREFIX)
    items = load_custom_filaments()
    filtered = [f for f in items if f.id != bare]
    if len(filtered) == len(items):
        raise KeyError(f"Custom filament not found: {color_id}")
    save_custom_filaments(filtered)


def library_to_export_dict(filaments: list[CustomFilament] | None = None) -> dict[str, Any]:
    items = filaments if filaments is not None else load_custom_filaments()
    return {
        "format": LIBRARY_FORMAT,
        "version": LIBRARY_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "filaments": [asdict(f) for f in items],
    }


def merge_filaments_from_dict(data: dict[str, Any], *, replace_same_id: bool = True) -> int:
    """Merge filaments from kit bundle or library file. Returns count merged."""
    raw_list = data.get("filaments")
    if not isinstance(raw_list, list):
        return 0
    incoming: list[CustomFilament] = []
    for raw in raw_list:
        if isinstance(raw, dict):
            entry = _normalize_entry(raw)
            if entry:
                incoming.append(entry)
    if not incoming:
        return 0
    existing = {f.id: f for f in load_custom_filaments()}
    for entry in incoming:
        if replace_same_id or entry.id not in existing:
            existing[entry.id] = entry
    save_custom_filaments(sorted(existing.values(), key=lambda c: c.combo_label.lower()))
    return len(incoming)


def export_library_file(dest: Path, filaments: list[CustomFilament] | None = None) -> Path:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(library_to_export_dict(filaments), indent=2, ensure_ascii=False)
    dest.write_text(payload, encoding="utf-8")
    return dest


def import_library_file(path: Path) -> int:
    path = Path(path)
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    if data.get("format") not in (LIBRARY_FORMAT, None):
        if "filaments" not in data:
            raise ValueError("Not a Print Partner custom filaments file")
    if int(data.get("version", 1)) != LIBRARY_VERSION:
        raise ValueError(f"Unsupported library version (expected {LIBRARY_VERSION})")
    return merge_filaments_from_dict(data)


def collect_custom_ids_from_parts(parts: list) -> list[CustomFilament]:
    """Return custom filament entries referenced by parts' filament_color_id."""
    needed: set[str] = set()
    for part in parts:
        fid = getattr(part, "filament_color_id", None) or (
            part.get("filament_color_id") if isinstance(part, dict) else None
        )
        if fid and str(fid).startswith(CUSTOM_PREFIX):
            needed.add(str(fid))
    if not needed:
        return []
    by_id = {f.color_id: f for f in load_custom_filaments()}
    return [by_id[fid] for fid in needed if fid in by_id]


# Late import avoids circular dependency at module load
def load_catalog():
    from print_partner.core.ambrosia_catalog import load_catalog as _load

    return _load()
