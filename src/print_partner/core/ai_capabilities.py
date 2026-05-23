"""App capability manifest for the AI assistant system prompt."""

from __future__ import annotations

ACTION_SCHEMA = """
Allowed action types (return in JSON "actions" array):
- include: {"type":"include","part_id":int,"reason":str}
- exclude: {"type":"exclude","part_id":int,"reason":str}
- set_filament: {"type":"set_filament","part_id":int,"filament_color_id":str,"reason":str}
- set_role: {"type":"set_role","part_id":int,"role":"primary"|"accent"|"clear"|"opaque","reason":str}
- set_quantity: {"type":"set_quantity","part_id":int,"quantity":int,"reason":str}
- set_notes: {"type":"set_notes","part_id":int,"notes":str,"reason":str}
- assign_filament_to_role: {"type":"assign_filament_to_role","role":str,"filament_color_id":str,"reason":str}
- navigate: {"type":"navigate","target":"libraries"|"compose"|"review"|"checkoff","reason":str}

User must confirm before actions are applied. Use only part_id values from context.
"""


def workflow_manifest() -> str:
    return """
## Application workflow
1. Libraries — add/sync Git repos; import which STL paths to include.
2. Kit — Compose: layers, recompute, filament colors, include/exclude parts.
   Kit — Review: included parts only before printing.
3. Checkoff — printable checklist, print progress, export HTML.

You cannot add repos or change layers via actions; suggest the user use New build wizard or Libraries tab.
""".strip()
