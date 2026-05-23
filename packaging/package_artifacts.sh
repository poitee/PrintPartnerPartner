#!/usr/bin/env bash
# Zip/tar release artifacts from dist/ after PyInstaller build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
VERSION="${PRINT_PARTNER_VERSION:-}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(cd "$ROOT" && PYTHONPATH=src python3 -c "from print_partner import __version__; print(__version__)")"
fi

OS="$(uname -s)"
ARCH="$(uname -m)"
ARTIFACTS="$DIST/artifacts"
mkdir -p "$ARTIFACTS"

name_for_platform() {
  case "$OS" in
    Darwin) echo "print-partner-${VERSION}-macos-${ARCH}" ;;
    Linux) echo "print-partner-${VERSION}-linux-${ARCH}" ;;
    MINGW*|MSYS*|CYGWIN*|Windows*) echo "print-partner-${VERSION}-windows-${ARCH}" ;;
    *) echo "print-partner-${VERSION}-${OS}-${ARCH}" ;;
  esac
}

BASE="$(name_for_platform)"

if [[ "$OS" == "Darwin" && -d "$DIST/Print Partner.app" ]]; then
  echo "Packaging macOS .app…"
  (cd "$DIST" && ditto -c -k --sequesterRsrc --keepParent "Print Partner.app" "$ARTIFACTS/${BASE}.zip")
  if command -v hdiutil >/dev/null 2>&1; then
    rm -f "$DIST/Print-Partner-${VERSION}.dmg"
    hdiutil create -volname "Print Partner" -srcfolder "$DIST/Print Partner.app" -ov -format UDZO \
      "$DIST/Print-Partner-${VERSION}.dmg" >/dev/null
    cp "$DIST/Print-Partner-${VERSION}.dmg" "$ARTIFACTS/"
    echo "  $ARTIFACTS/Print-Partner-${VERSION}.dmg"
  fi
  echo "  $ARTIFACTS/${BASE}.zip"
elif [[ -d "$DIST/Print Partner" ]]; then
  echo "Packaging onedir folder…"
  if [[ "$OS" == "Linux" ]]; then
    tar -czf "$ARTIFACTS/${BASE}.tar.gz" -C "$DIST" "Print Partner"
    echo "  $ARTIFACTS/${BASE}.tar.gz"
  else
    (cd "$DIST" && zip -r "$ARTIFACTS/${BASE}.zip" "Print Partner")
    echo "  $ARTIFACTS/${BASE}.zip"
  fi
else
  echo "No dist bundle found. Run ./packaging/build_release.sh first." >&2
  exit 1
fi

echo "Version: $VERSION"
