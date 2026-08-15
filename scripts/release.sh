#!/bin/bash
# Release script for Print Partner
# Usage: ./scripts/release.sh patch|minor|major

set -e

BUMP_TYPE="${1:-patch}"

if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: $0 patch|minor|major"
  exit 1
fi

echo "📦 Preparing $BUMP_TYPE release..."

# Get current version from main package.json
CURRENT_VERSION=$(jq -r '.version' web/package.json)
echo "Current version: $CURRENT_VERSION"

# Use npm version to bump and create tag
cd web
npm version "$BUMP_TYPE" --git-tag-version

# Get new version
NEW_VERSION=$(jq -r '.version' package.json)
echo "New version: $NEW_VERSION"

cd ..

# Create annotated tag with changelog
COMMITS_SINCE_LAST=$(git log --oneline $(git describe --tags --abbrev=0 2>/dev/null)..HEAD | wc -l)
git tag -d "v$NEW_VERSION" 2>/dev/null || true

git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION

Commits: $COMMITS_SINCE_LAST
Date: $(date -u +'%Y-%m-%dT%H:%M:%SZ')

$(git log --oneline $(git describe --tags --abbrev=0 2>/dev/null)..HEAD | sed 's/^/- /')"

echo "✅ Tagged: v$NEW_VERSION"
echo ""
echo "To push the release:"
echo "  git push origin main"
echo "  git push origin v$NEW_VERSION"
