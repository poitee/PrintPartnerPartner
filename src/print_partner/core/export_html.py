"""HTML export via Jinja2."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Callable, Optional

from jinja2 import Environment, select_autoescape

from print_partner.core.merge import MergePart
from print_partner.core.parts_grouping import folder_key_from_relative_path
from print_partner.core.ambrosia_catalog import resolve_filament_hex
from print_partner.core.thumbnails import ProgressCallback, ensure_thumbnail


def export_path_for_profile(profile_name: str, exports_dir: Path) -> Path:
    """Default HTML path for a profile (matches export naming)."""
    safe = profile_name.replace(" ", "_")
    return exports_dir / f"{safe}.html"


def open_html_file(path: Path) -> bool:
    """Open an HTML file in the default browser. Returns False if missing."""
    resolved = path.resolve()
    if not resolved.is_file():
        return False
    from PySide6.QtCore import QUrl
    from PySide6.QtGui import QDesktopServices

    return QDesktopServices.openUrl(QUrl.fromLocalFile(str(resolved)))


def _repo_sort_key(source_layer: str) -> tuple:
    if source_layer.startswith("base:"):
        return (0, source_layer.lower())
    return (1, source_layer.lower())


def _build_export_row(
    p: MergePart,
    *,
    completed_by_match_key: dict[str, list[bool]],
) -> dict:
    qty = max(1, p.quantity_effective)
    completed = completed_by_match_key.get(p.match_key, [])
    units = []
    for unit_index in range(qty):
        checked = completed[unit_index] if unit_index < len(completed) else False
        units.append(
            {
                "index": unit_index,
                "checked": checked,
                "storage_key": f"{p.match_key}-{unit_index}",
            }
        )
    return {
        "relative_path": p.relative_path,
        "filename": p.filename,
        "role": p.role,
        "quantity": qty,
        "notes": p.notes,
        "thumbnail": None,
        "filament_display": p.filament_display,
        "filament_hex": p.filament_hex,
        "filament_swatch_url": p.filament_swatch_url,
        "units": units,
    }


_EXPORT_ENV = Environment(autoescape=select_autoescape(["html", "xml"]))
EXPORT_TEMPLATE = _EXPORT_ENV.from_string("""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{{ title }}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; }
    th, td { border: 1px solid #ccc; padding: 0.5rem; text-align: left; vertical-align: middle; }
    th { background: #f4f4f4; }
    img.thumb { max-width: 96px; max-height: 96px; object-fit: contain; background: #fafafa; }
    img.swatch { width: 20px; height: 20px; border-radius: 3px; border: 1px solid #ccc; vertical-align: middle; margin-right: 6px; }
    .swatch-dot { display: inline-block; width: 20px; height: 20px; border-radius: 3px; border: 1px solid #ccc; vertical-align: middle; margin-right: 6px; }
    .no-thumb { color: #999; font-size: 0.85rem; }
    .filaments-used { margin: 1rem 0; padding: 0.75rem 1rem; background: #f8f8f8; border-radius: 6px; }
    .filaments-used ul { margin: 0.5rem 0 0; padding-left: 1.25rem; }
    .qty-checks { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .qty-checks input[type=checkbox] { width: 1.1rem; height: 1.1rem; cursor: pointer; }
    h2.repo-section { margin-top: 2rem; margin-bottom: 0.5rem; }
    h3.folder-section { margin: 1rem 0 0.5rem 1rem; color: #333; font-size: 1rem; font-weight: 600; }
    .subtitle { color: #555; margin-top: -0.5rem; }
    .repo-meta { color: #666; font-size: 0.9rem; margin: 0 0 0.75rem 0; }
  </style>
</head>
<body>
  <h1>{{ title }}</h1>
  {% if order_number %}<p class="subtitle"><strong>Order #:</strong> {{ order_number }}</p>{% endif %}
  <p>{{ part_count }} parts</p>
  {% if filaments_used %}
  <div class="filaments-used">
    <strong>Filaments in this build</strong>
    <ul>
    {% for f in filaments_used %}
      <li>{% if f.swatch_url %}<img class="swatch" src="{{ f.swatch_url }}" alt="">{% elif f.hex %}<span class="swatch-dot" style="background:{{ f.hex }}"></span>{% endif %}{{ f.label }}</li>
    {% endfor %}
    </ul>
  </div>
  {% endif %}
  {% for repo in repo_sections %}
  <h2 class="repo-section">{{ repo.label }}</h2>
  <p class="repo-meta">{{ repo.part_count }} part(s) in this repository</p>
  {% for folder in repo.folders %}
  <h3 class="folder-section">{{ folder.label }}</h3>
  <table>
    <thead>
      <tr>
        <th>Filename</th>
        <th>Role</th>
        <th>Filament</th>
        <th>Qty</th>
        <th>Print</th>
        <th>Thumb</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
    {% for p in folder.parts %}
      <tr>
        <td>{{ p.filename }}</td>
        <td>{{ p.role }}</td>
        <td>{% if p.filament_display %}{% if p.filament_swatch_url %}<img class="swatch" src="{{ p.filament_swatch_url }}" alt="">{% elif p.filament_hex %}<span class="swatch-dot" style="background:{{ p.filament_hex }}"></span>{% endif %}{{ p.filament_display }}{% else %}—{% endif %}</td>
        <td>{{ p.quantity }}</td>
        <td>
          <span class="qty-checks">
          {% for u in p.units %}
            <input type="checkbox"
              data-storage-key="{{ u.storage_key }}"
              {% if u.checked %}checked{% endif %}
              {% if p.filament_hex %}style="accent-color: {{ p.filament_hex }}"{% endif %}
              title="Unit {{ u.index + 1 }}">
          {% endfor %}
          </span>
        </td>
        <td>{% if p.thumbnail %}<img class="thumb" src="{{ p.thumbnail }}" alt="{{ p.filename }}">{% else %}<span class="no-thumb">—</span>{% endif %}</td>
        <td>{{ p.notes }}</td>
      </tr>
    {% endfor %}
    </tbody>
  </table>
  {% endfor %}
  {% endfor %}
  {% if profile_id %}
  <script>
  (function() {
    var prefix = "print-partner-{{ profile_id }}-";
    document.querySelectorAll('input[data-storage-key]').forEach(function(cb) {
      var key = prefix + cb.getAttribute('data-storage-key');
      try {
        var stored = localStorage.getItem(key);
        if (stored === "1") cb.checked = true;
        else if (stored === "0") cb.checked = false;
      } catch (e) {}
      cb.addEventListener('change', function() {
        try { localStorage.setItem(key, cb.checked ? "1" : "0"); } catch (e) {}
      });
    });
  })();
  </script>
  {% endif %}
</body>
</html>
""")


def export_profile_html(
    profile_name: str,
    parts: list[MergePart],
    output_path: Path,
    on_progress: ProgressCallback | None = None,
    *,
    cancel_check: Optional[Callable[[], bool]] = None,
    order_number: str | None = None,
    profile_id: int | None = None,
    completed_by_match_key: dict[str, list[bool]] | None = None,
) -> tuple[Path, int, int]:
    """Write HTML checklist grouped by source repo and folder. Returns (path, parts, thumbs)."""
    included = [p for p in parts if p.included]
    by_repo_folder: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    thumb_count = 0
    filament_labels: dict[str, dict] = {}
    total = len(included)
    completed_by_match_key = completed_by_match_key or {}

    for i, p in enumerate(included):
        if cancel_check and cancel_check():
            break
        if on_progress:
            on_progress(i + 1, total, p.filename)
        mesh_hex = resolve_filament_hex(p.filament_color_id, p.role) or p.filament_hex
        thumb = ensure_thumbnail(
            p.absolute_path,
            output_path.parent,
            p.role,
            mesh_hex=mesh_hex,
            force=bool(mesh_hex),
        )
        if thumb:
            thumb_count += 1
        if p.filament_display:
            key = p.filament_color_id or p.filament_display
            filament_labels[key] = {
                "label": p.filament_display,
                "hex": p.filament_hex,
                "swatch_url": p.filament_swatch_url,
            }
        repo_label = p.source_layer or "unknown"
        folder_label = folder_key_from_relative_path(p.relative_path)
        row = _build_export_row(p, completed_by_match_key=completed_by_match_key)
        row["thumbnail"] = thumb
        by_repo_folder[repo_label][folder_label].append(row)

    repo_sections: list[dict] = []
    for repo_label in sorted(by_repo_folder.keys(), key=_repo_sort_key):
        folders_map = by_repo_folder[repo_label]
        folder_sections: list[dict] = []
        for folder_label in sorted(folders_map.keys(), key=str.lower):
            parts_rows = sorted(folders_map[folder_label], key=lambda r: r["filename"].lower())
            folder_sections.append(
                {
                    "label": folder_label,
                    "parts": parts_rows,
                }
            )
        part_count_repo = sum(len(f["parts"]) for f in folder_sections)
        repo_sections.append(
            {
                "label": repo_label,
                "part_count": part_count_repo,
                "folders": folder_sections,
            }
        )

    part_count = sum(s["part_count"] for s in repo_sections)
    filaments_used = sorted(filament_labels.values(), key=lambda x: x["label"].lower())

    title = f"Print Partner — {profile_name}"
    if order_number:
        title = f"{title} (Order {order_number})"

    html = EXPORT_TEMPLATE.render(
        title=title,
        order_number=order_number,
        part_count=part_count,
        repo_sections=repo_sections,
        filaments_used=filaments_used,
        profile_id=profile_id,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    return output_path, part_count, thumb_count
