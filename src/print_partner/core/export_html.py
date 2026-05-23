"""HTML export via Jinja2."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, select_autoescape

from print_partner.core.checklist_export_css import CHECKLIST_EXPORT_CSS
from print_partner.core.merge import MergePart
from print_partner.core.parts_grouping import folder_key_from_relative_path
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
    unit_flags = [
        completed[unit_index] if unit_index < len(completed) else False
        for unit_index in range(qty)
    ]
    all_printed = bool(unit_flags) and all(unit_flags)
    return {
        "relative_path": p.relative_path,
        "filename": p.filename,
        "role": p.role,
        "quantity": qty,
        "notes": p.notes,
        "thumbnail": None,
        "filament_display": p.filament_display,
        "filament_hex": p.filament_hex,
        "all_printed": all_printed,
        "storage_key": p.match_key,
    }


_EXPORT_ENV = Environment(autoescape=select_autoescape(["html", "xml"]))
EXPORT_TEMPLATE = _EXPORT_ENV.from_string(
    """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ title }}</title>
  <style>
"""
    + CHECKLIST_EXPORT_CSS
    + """
    table.parts-table col.col-filename { width: 36%; }
    table.parts-table col.col-qty { width: 6%; }
    table.parts-table col.col-printed { width: 9%; }
    table.parts-table col.col-verified { width: 9%; }
    table.parts-table col.col-thumb { width: 20%; }
    table.parts-table col.col-notes { width: 20%; }
  </style>
</head>
<body>
  <div class="checklist-doc">
    <header class="doc-header">
      <p class="doc-kicker">Print Partner · Build checklist</p>
      <h1 class="doc-title">{{ profile_name }}</h1>
      <p class="doc-meta">
        {% if order_number %}<strong>Order #</strong> {{ order_number }} · {% endif %}
        <strong>{{ part_count }}</strong> part(s) · Generated {{ generated_at }}
      </p>
    </header>
    {% for repo in repo_sections %}
    <section class="repo-section">
      <h2 class="repo-heading">{{ repo.label }}</h2>
      <p class="repo-meta">{{ repo.part_count }} part(s) in this repository</p>
      {% for folder in repo.folders %}
      <h3 class="folder-heading">{{ folder.label }}</h3>
      <table class="parts-table">
        <colgroup>
          <col class="col-filename">
          <col class="col-qty">
          <col class="col-printed">
          <col class="col-verified">
          <col class="col-thumb">
          <col class="col-notes">
        </colgroup>
        <thead>
          <tr>
            <th>Part</th>
            <th>Qty</th>
            <th class="check-col">Print</th>
            <th class="check-col">Verify</th>
            <th>Preview</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
        {% for p in folder.parts %}
          <tr>
            <td class="filename-cell">
              <div class="part-row">
                {% if p.filament_hex %}<span class="swatch-dot part-swatch" style="background:{{ p.filament_hex }}" title="{{ p.filament_display }}"></span>{% endif %}
                <div class="part-text">
                  <span class="part-name">{{ p.filename }}</span>
                  {% if p.role %}<span class="part-role">{{ p.role }}</span>{% endif %}
                </div>
              </div>
            </td>
            <td class="qty-cell">{{ p.quantity }}</td>
            <td class="check-cell">
              <span class="check-box{% if p.all_printed %} checked{% endif %}"
                {% if p.filament_hex %}data-color="{{ p.filament_hex }}" style="--check-color: {{ p.filament_hex }}"{% endif %}
                aria-hidden="true"></span>
              <input type="checkbox" class="checkbox-screen"
                data-storage-key="{{ p.storage_key }}"
                {% if p.all_printed %}checked{% endif %}
                {% if p.filament_hex %}style="accent-color: {{ p.filament_hex }}"{% endif %}
                title="Mark all copies printed">
            </td>
            <td class="check-cell">
              <span class="check-box" aria-hidden="true"></span>
              <input type="checkbox" class="checkbox-screen customer-verify"
                title="Customer verified (print only)">
            </td>
            <td class="thumb-cell">{% if p.thumbnail %}<div class="thumb-wrap"><img class="thumb" src="{{ p.thumbnail }}" alt=""></div>{% else %}<span class="no-thumb">—</span>{% endif %}</td>
            <td class="notes-cell">{{ p.notes }}</td>
          </tr>
        {% endfor %}
        </tbody>
      </table>
      {% endfor %}
    </section>
    {% endfor %}
    <p class="screen-hint no-print">On screen: use checkboxes to track progress in this browser. When printing, use the empty boxes in the Print and Verify columns.</p>
  </div>
  {% if profile_id %}
  <script class="no-print">
  (function() {
    var prefix = "print-partner-{{ profile_id }}-";
    document.querySelectorAll('input[data-storage-key]').forEach(function(cb) {
      var key = prefix + cb.getAttribute('data-storage-key');
      var box = cb.previousElementSibling;
      function syncBox() {
        if (box && box.classList.contains('check-box')) {
          if (cb.checked) box.classList.add('checked');
          else box.classList.remove('checked');
        }
      }
      try {
        var stored = localStorage.getItem(key);
        if (stored === "1") cb.checked = true;
        else if (stored === "0") cb.checked = false;
      } catch (e) {}
      syncBox();
      cb.addEventListener('change', function() {
        try { localStorage.setItem(key, cb.checked ? "1" : "0"); } catch (e) {}
        syncBox();
      });
    });
  })();
  </script>
  {% endif %}
</body>
</html>
"""
)


def export_profile_html(
    profile_name: str,
    parts: list[MergePart],
    output_path: Path,
    on_progress: ProgressCallback | None = None,
    *,
    cancel_check: Callable[[], bool] | None = None,
    order_number: str | None = None,
    profile_id: int | None = None,
    completed_by_match_key: dict[str, list[bool]] | None = None,
) -> tuple[Path, int, int]:
    """Write HTML checklist grouped by source repo and folder. Returns (path, parts, thumbs)."""
    included = [p for p in parts if p.included]
    by_repo_folder: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    thumb_count = 0
    total = len(included)
    completed_by_match_key = completed_by_match_key or {}

    for i, p in enumerate(included):
        if cancel_check and cancel_check():
            break
        if on_progress:
            on_progress(i + 1, total, p.filename)
        mesh_hex = p.filament_hex
        thumb = ensure_thumbnail(
            p.absolute_path,
            output_path.parent,
            p.role,
            mesh_hex=mesh_hex,
            force=bool(mesh_hex),
        )
        if thumb:
            thumb_count += 1
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

    title = f"Print Partner — {profile_name}"
    if order_number:
        title = f"{title} (Order {order_number})"
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    html = EXPORT_TEMPLATE.render(
        title=title,
        profile_name=profile_name,
        order_number=order_number,
        part_count=part_count,
        generated_at=generated_at,
        repo_sections=repo_sections,
        profile_id=profile_id,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    return output_path, part_count, thumb_count
