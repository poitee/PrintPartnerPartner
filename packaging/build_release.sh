#!/usr/bin/env bash
# Build a release onedir bundle: venv, pytest, PyInstaller.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# NumPy 2.x macOS arm64 wheels often require macOS 14+ (Accelerate NEWLAPACK).
# Pin NumPy 1.26.x and target macOS 12+ for broader compatibility (Option B).
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-12.0}"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

pip install -q -U pip
pip install -q -e ".[dev]"
pip install -q "numpy>=1.26.4,<2"

echo "Build venv NumPy: $(python -c 'import numpy; print(numpy.__version__)')"

echo "Running ruff…"
ruff check src tests

echo "Running tests…"
pytest --maxfail=1 -q

echo "Building onedir bundle…"
pyinstaller packaging/print_partner.spec --noconfirm

if [[ "$(uname -s)" == "Darwin" ]]; then
  python packaging/verify_macos_numpy.py
  echo "Built: dist/Print Partner.app"
else
  echo "Built: dist/Print Partner/"
fi

chmod +x packaging/package_artifacts.sh
./packaging/package_artifacts.sh
echo "Artifacts in dist/artifacts/"
