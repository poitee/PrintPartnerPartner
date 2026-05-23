# Print Partner — release build

## Prerequisites

- Python 3.11+
- macOS or Linux (Windows: use the onedir folder under `dist/`)
- Git (for syncing STL repositories inside the app)

## Build

From the repository root:

```bash
./packaging/build_release.sh
```

This creates a venv (if needed), pins **NumPy 1.26.x** (not 2.x), sets `MACOSX_DEPLOYMENT_TARGET=12.0` on macOS, runs `pytest`, builds with PyInstaller, and verifies the frozen NumPy extension is not macOS-14-only.

**macOS compatibility:** Release builds target **macOS 12 Monterey and later** (Intel and Apple Silicon). NumPy 2.x wheels bundled by mistake require macOS 14+ and fail with `NEWLAPACK` / Accelerate errors on older systems.

**Output**

| Platform | Path |
|----------|------|
| macOS | `dist/Print Partner.app` |
| Linux / Windows | `dist/Print Partner/` |

## macOS DMG (optional)

After a successful build on macOS:

```bash
./packaging/make_dmg.sh
```

Produces `dist/Print-Partner-<version>.dmg` for drag-and-drop install.

## Platform archives

After `build_release.sh`, versioned files are under `dist/artifacts/`:

- macOS: `print-partner-<version>-macos-<arch>.zip` (+ DMG above)
- Linux: `print-partner-<version>-linux-<arch>.tar.gz`
- Windows: run `package_artifacts.sh` on Windows or use the CI zip

## GitHub Releases

Push a tag matching `v*` (e.g. `v0.1.0`). Workflow `.github/workflows/release.yml` builds on Ubuntu, macOS, and Windows and uploads archives to the GitHub Release.

## macOS notarization

```bash
./packaging/notarize_macos.sh
```

Requires Apple Developer ID and `notarytool` credentials (see script header).

## Smoke test

See [docs/RELEASE_SMOKE_TEST.md](../docs/RELEASE_SMOKE_TEST.md) before shipping a build.

## Data locations

Runtime data lives under `~/.print-partner/` (database, synced repos, exports, thumbnails). The app **Help** menu can open the data and exports folders.

## Environment

Optional overrides use the `PRINT_PARTNER_` prefix, e.g. `PRINT_PARTNER_DATA_DIR` for `data_dir` in `print_partner.config`.
