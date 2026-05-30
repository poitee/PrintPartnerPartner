# AGENTS.md

Guidance for AI agents working in this repository.

## Cursor Cloud specific instructions

Print Partner is a **single Python/PySide6 desktop app** (no web server, Docker, or monorepo). See `README.md` and `docs/ARCHITECTURE.md` for product context.

### One-time VM system packages (Linux)

CI and local GUI both need OpenGL/EGL/Qt libraries. For **interactive GUI** on X11 (`DISPLAY` set), also install XCB/XKB helpers if Qt reports a missing `xcb` platform plugin:

```bash
sudo apt-get install -y --no-install-recommends \
  python3.12-venv \
  libegl1 libgl1 libglib2.0-0 libxkbcommon0 libdbus-1-3 \
  libxcb-xfixes0 libxcb-cursor0 libfontconfig1 \
  libxkbcommon-x11-0 libxcb-icccm4 libxcb-keysyms1 libxcb-xkb1
```

(`python3.12-venv` is required before `python3 -m venv .venv` on Debian/Ubuntu.)

### Python environment

From repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

### Lint and tests

Match CI (`.github/workflows/ci.yml`):

```bash
source .venv/bin/activate
ruff check src tests
QT_QPA_PLATFORM=offscreen pytest -q
```

Tests use an isolated temp data dir via `tests/conftest.py` — they do not touch `~/.print-partner`.

### Run the desktop app

```bash
source .venv/bin/activate
print-partner
```

Use `PRINT_PARTNER_DATA_DIR=/path/to/dir` to keep dev data out of `~/.print-partner` (see `print_partner/config.py`).

### Optional tools

- `git` on PATH — required for GitHub sync flows; local-folder repos work without network.
- `stl-thumb` — faster thumbnails; PyVista fallback is built in.

### Release build

`packaging/build_release.sh` runs pytest then PyInstaller; see `packaging/README_RELEASE.md`.
