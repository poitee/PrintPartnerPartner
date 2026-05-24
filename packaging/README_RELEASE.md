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


## Legal files in release bundles

`LICENSE`, `THIRD_PARTY_NOTICES.md`, and `COMMERCIAL.md` are copied into the onedir bundle root (next to the executable) by `print_partner.spec`. Help → **Third-party notices** / **License** in the app opens these files.

## Platform archives

After `build_release.sh`, versioned files are under `dist/artifacts/`:

- macOS: `print-partner-<version>-macos-<arch>.zip` (+ DMG above)
- Linux: `print-partner-<version>-linux-<arch>.tar.gz`
- Windows: run `package_artifacts.sh` on Windows or use the CI zip

## GitHub Releases

Shared build logic lives in [`.github/workflows/build-reusable.yml`](../.github/workflows/build-reusable.yml) (used by **Build all platforms** and **Release**).

### Verify all platforms (recommended before tagging)

1. Bump `pyproject.toml`, `src/print_partner/__init__.py`, and `CHANGELOG.md` (`## [X.Y.Z]`) on `main`.
2. Open **Actions** → **Build all platforms** → confirm **linux**, **macos**, and **windows** are green (also runs on every push to `main`).
3. Download artifacts from the run to smoke-test locally.

Validate locally:

```bash
python packaging/verify_release_version.py 0.2.3
```

### Publish a release (two options)

**Option A — CLI tag**

```bash
git tag -a v0.2.3 -m "Release 0.2.3"
git push origin v0.2.3
```

**Option B — Actions button**

1. **Actions** → **Release (create tag)** → **Run workflow**
2. Enter version `0.2.3`; use **dry run** to validate only
3. On success, the workflow pushes `v0.2.3`, which triggers **Release** (build + publish)

Both paths run [`.github/workflows/release.yml`](../.github/workflows/release.yml), which checks version/CHANGELOG, builds on **Ubuntu**, **macOS 14**, and **Windows**, and publishes with the matching **CHANGELOG** section as release notes.

**CI artifacts are unsigned.** macOS notarization remains a local maintainer step (below).

Workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml) attaches:

| Platform | Artifact |
|----------|----------|
| Linux | `print-partner-<ver>-linux-<arch>.tar.gz` |
| macOS | `print-partner-<ver>-macos-<arch>.zip` (+ optional `.dmg`) |
| Windows | `print-partner-<ver>-windows.zip` |

Each build job has a **120 minute** timeout. The publish step fails if any of the three platform archives is missing.

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
