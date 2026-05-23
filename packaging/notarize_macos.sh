#!/usr/bin/env bash
# Sign and notarize Print Partner.app for Gatekeeper (requires Apple Developer credentials).
#
# Prerequisites:
#   - Developer ID Application certificate in Keychain
#   - xcrun notarytool configured (Apple ID app password or API key)
#
# Usage (after ./packaging/build_release.sh):
#   export DEVELOPER_ID="Developer ID Application: Your Name (TEAMID)"
#   export APPLE_ID="you@example.com"
#   export APPLE_TEAM_ID="TEAMID"
#   export APPLE_APP_PASSWORD="@keychain:AC_PASSWORD"  # or NOTARY_API_KEY chain
#   ./packaging/notarize_macos.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/Print Partner.app"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS only." >&2
  exit 1
fi

if [[ ! -d "$APP" ]]; then
  echo "Missing $APP — run ./packaging/build_release.sh first." >&2
  exit 1
fi

: "${DEVELOPER_ID:?Set DEVELOPER_ID to your Developer ID Application identity}"

echo "Signing…"
codesign --deep --force --verify --verbose \
  --sign "$DEVELOPER_ID" \
  --options runtime \
  "$APP"

ZIP="$ROOT/dist/Print-Partner-notarize.zip"
ditto -c -k --keepParent "$APP" "$ZIP"

echo "Submitting for notarization…"
: "${APPLE_ID:?Set APPLE_ID}"
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID}"
: "${APPLE_APP_PASSWORD:?Set APPLE_APP_PASSWORD or configure notarytool API key}"

xcrun notarytool submit "$ZIP" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_PASSWORD" \
  --wait

echo "Stapling…"
xcrun stapler staple "$APP"

echo "Done. Create DMG with ./packaging/make_dmg.sh"
