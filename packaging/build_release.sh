#!/usr/bin/env bash
# Build a release onedir bundle: venv, pytest, PyInstaller.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

pip install -q -U pip
pip install -q -e ".[dev]"
pip install -q pyinstaller

echo "Running tests…"
pytest -q

echo "Building onedir bundle…"
pyinstaller packaging/print_partner.spec --noconfirm

if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "Done: dist/Print Partner.app"
else
  echo "Done: dist/Print Partner/"
fi
