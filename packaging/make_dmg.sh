#!/usr/bin/env bash
# Wrap dist/Print Partner.app in a drag-to-Applications DMG (macOS only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Print Partner"
APP_PATH="$ROOT/dist/${APP_NAME}.app"
DMG_PATH="$ROOT/dist/${APP_NAME}.dmg"
STAGING="$ROOT/dist/dmg-staging"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "make_dmg.sh is for macOS only." >&2
  exit 1
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "Missing bundle. Run ./packaging/build_release.sh first." >&2
  exit 1
fi

rm -rf "$STAGING" "$DMG_PATH"
mkdir -p "$STAGING"
cp -R "$APP_PATH" "$STAGING/"
ln -sf /Applications "$STAGING/Applications"

if command -v hdiutil >/dev/null 2>&1; then
  hdiutil create \
    -volname "$APP_NAME" \
    -srcfolder "$STAGING" \
    -ov \
    -format UDZO \
    "$DMG_PATH"
  echo "Created: $DMG_PATH"
else
  echo "hdiutil not found; staged folder only: $STAGING" >&2
  exit 1
fi

rm -rf "$STAGING"
