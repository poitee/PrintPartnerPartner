"""Generate many STL thumbnails in one process (amortize PyVista/VTK startup)."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) < 1:
        print("usage: thumb_batch_cli JOBS.json", file=sys.stderr)
        return 2
    jobs_path = Path(args[0])
    jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
    from print_partner.core.thumbnails import generate_thumbnail

    ok = 0
    failed = 0
    for job in jobs:
        stl = Path(job["stl"])
        out = Path(job["out"])
        role = job.get("role", "primary")
        mesh_hex = job.get("hex") or None
        if generate_thumbnail(stl, out, role, mesh_hex):
            ok += 1
        else:
            failed += 1
    print(json.dumps({"ok": ok, "failed": failed}))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
