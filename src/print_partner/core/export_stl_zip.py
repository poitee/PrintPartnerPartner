"""Export included profile parts as STL zips grouped by role and repo folder."""

from __future__ import annotations

import json
import re
import time
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Callable, Optional

from print_partner.core.merge import MergePart
from print_partner.core.parts_grouping import folder_key_from_relative_path

ROLE_ORDER = ("primary", "accent", "clear", "opaque")
ProgressCallback = Callable[[int, int, str], None]

_DEBUG_LOG = Path(__file__).resolve().parents[3] / ".cursor" / "debug-ae4f75.log"


def _stl_export_log(message: str, data: dict, hypothesis_id: str) -> None:
    # #region agent log
    try:
        payload = {
            "sessionId": "ae4f75",
            "timestamp": int(time.time() * 1000),
            "location": "export_stl_zip.py",
            "message": message,
            "data": data,
            "hypothesisId": hypothesis_id,
        }
        with _DEBUG_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except OSError:
        pass
    # #endregion


def _safe_zip_stem(folder_key: str) -> str:
    if folder_key == "(root)":
        return "_root"
    safe = re.sub(r"[^\w\-.]+", "_", folder_key.replace("/", "_"))
    return safe or "_root"


def _entry_name(part: MergePart, unit: int, used_names: set[str]) -> str:
    stem = Path(part.filename).stem
    suffix = Path(part.filename).suffix or ".stl"
    base = f"{stem}_{unit:02d}{suffix}"
    if base not in used_names:
        used_names.add(base)
        return base
    parent = folder_key_from_relative_path(part.relative_path)
    prefix = re.sub(r"[^\w\-.]+", "_", parent.replace("/", "_"))
    if prefix and prefix != "(root)":
        candidate = f"{prefix}_{base}"
    else:
        slug = re.sub(r"[^\w\-.]+", "_", part.match_key[:40])
        candidate = f"{slug}_{base}"
    used_names.add(candidate)
    return candidate


def export_profile_stl_zips(
    profile_name: str,
    parts: list[MergePart],
    exports_dir: Path,
    on_progress: Optional[ProgressCallback] = None,
    *,
    cancel_check: Optional[Callable[[], bool]] = None,
) -> tuple[Path, dict[str, int], list[str]]:
    """
    Export included parts with resolved absolute_path to role/folder zips.
    Returns (output_root, zip_count_by_role, warnings).
    """
    safe_profile = re.sub(r"[^\w\-.]+", "_", profile_name.replace(" ", "_"))
    output_root = exports_dir / safe_profile / "stl_export"
    output_root.mkdir(parents=True, exist_ok=True)

    included = [p for p in parts if p.included]
    missing_path = [p for p in included if not p.absolute_path or not p.absolute_path.is_file()]
    exportable = [p for p in included if p.absolute_path and p.absolute_path.is_file()]

    _stl_export_log(
        "export start",
        {
            "profile": profile_name,
            "output_root": str(output_root),
            "included": len(included),
            "exportable": len(exportable),
            "missing_path": len(missing_path),
        },
        "H1",
    )

    by_role_folder: dict[str, dict[str, list[tuple[MergePart, int]]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for part in exportable:
        role = part.role if part.role in ROLE_ORDER else "primary"
        folder = folder_key_from_relative_path(part.relative_path)
        qty = max(1, part.quantity_effective)
        for unit in range(1, qty + 1):
            by_role_folder[role][folder].append((part, unit))

    warnings: list[str] = [
        f"Missing STL: {p.relative_path} ({p.source_layer})" for p in missing_path
    ]
    zip_counts: dict[str, int] = {r: 0 for r in ROLE_ORDER}
    total = sum(len(entries) for folders in by_role_folder.values() for entries in folders.values())
    done = 0

    for role in ROLE_ORDER:
        folders = by_role_folder.get(role, {})
        if not folders:
            continue
        role_dir = output_root / role
        role_dir.mkdir(parents=True, exist_ok=True)
        for folder, entries in sorted(folders.items()):
            zip_path = role_dir / f"{_safe_zip_stem(folder)}.zip"
            used_names: set[str] = set()
            wrote_any = False
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for part, unit in entries:
                    if cancel_check and cancel_check():
                        break
                    done += 1
                    if on_progress:
                        on_progress(done, max(1, total), part.filename)
                    stl_path = part.absolute_path
                    assert stl_path is not None
                    entry = _entry_name(part, unit, used_names)
                    zf.write(stl_path, arcname=entry)
                    wrote_any = True
            if wrote_any:
                zip_counts[role] = zip_counts.get(role, 0) + 1
            elif zip_path.exists():
                zip_path.unlink()

    result_counts = {k: v for k, v in zip_counts.items() if v}
    _stl_export_log(
        "export done",
        {"zip_counts": result_counts, "warnings": len(warnings)},
        "H1",
    )
    return output_root, result_counts, warnings
