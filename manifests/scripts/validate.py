#!/usr/bin/env python3
"""Validate canonical manifests and their generated server copies."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
from typing import Any

from jsonschema import Draft202012Validator
import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = REPO_ROOT / "manifests" / "schema"


def _load_yaml(path: Path) -> tuple[Any | None, list[str]]:
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8")), []
    except (OSError, UnicodeError, yaml.YAMLError) as error:
        return None, [f"{path}: YAML parse failed: {error}"]


def validate_manifest(path: Path, schema_dir: Path = SCHEMA_DIR) -> list[str]:
    """Return deterministic validation errors for one versioned manifest."""
    document, errors = _load_yaml(path)
    if errors:
        return errors
    if not isinstance(document, dict):
        return [f"{path}: manifest must be a YAML mapping"]

    version = document.get("version")
    if not isinstance(version, int) or isinstance(version, bool):
        return [f"{path}: manifest version must be an integer"]
    if version not in (1, 2):
        return [f"{path}: unsupported manifest version {version}"]

    schema_path = schema_dir / f"print-partner-manifest-v{version}.json"
    try:
        schema = yaml.safe_load(schema_path.read_text(encoding="utf-8"))
        validator = Draft202012Validator(schema)
    except (OSError, UnicodeError, yaml.YAMLError) as error:
        return [f"{schema_path}: schema load failed: {error}"]

    validation_errors = sorted(
        validator.iter_errors(document),
        key=lambda error: (list(error.absolute_path), error.message),
    )
    rendered: list[str] = []
    for error in validation_errors:
        field = ".".join(str(part) for part in error.absolute_path) or "<root>"
        rendered.append(f"{path}: schema validation failed at {field}: {error.message}")
    return rendered


def _canonical_embedded_pairs(repo_root: Path) -> tuple[list[tuple[Path, Path]], list[str]]:
    manifests_root = repo_root / "manifests"
    registry_path = manifests_root / "registry" / "index.yaml"
    embedded_dir = repo_root / "web" / "apps" / "server" / "src" / "data" / "manifests"
    pairs = [(registry_path, embedded_dir / "registry-index.yaml")]
    errors: list[str] = []

    registry, parse_errors = _load_yaml(registry_path)
    errors.extend(parse_errors)
    if parse_errors:
        return pairs, errors
    if not isinstance(registry, dict) or not isinstance(registry.get("entries"), list):
        return pairs, [f"{registry_path}: registry must contain an entries array"]

    community_root = (manifests_root / "community").resolve()
    expected_embedded = {"registry-index.yaml"}
    for index, entry in enumerate(registry["entries"]):
        if not isinstance(entry, dict):
            errors.append(f"{registry_path}: entries[{index}] must be a mapping")
            continue
        slug = entry.get("slug")
        manifest_file = entry.get("manifest_file")
        if not isinstance(slug, str) or not slug:
            errors.append(f"{registry_path}: entries[{index}].slug must be a non-empty string")
            continue
        if not isinstance(manifest_file, str) or not manifest_file:
            errors.append(
                f"{registry_path}: entries[{index}].manifest_file must be a non-empty string"
            )
            continue
        canonical = (community_root / manifest_file).resolve()
        if not canonical.is_relative_to(community_root):
            errors.append(
                f"{registry_path}: entries[{index}].manifest_file escapes manifests/community"
            )
            continue
        embedded = embedded_dir / f"{slug}.yaml"
        expected_embedded.add(embedded.name)
        pairs.append((canonical, embedded))

    if embedded_dir.exists():
        for embedded in sorted(embedded_dir.glob("*.yaml")):
            if embedded.name not in expected_embedded:
                errors.append(
                    f"{embedded}: generated embedded copy has no canonical registry entry"
                )
    return pairs, errors


def check_embedded_copy_drift(repo_root: Path = REPO_ROOT) -> list[str]:
    """Require server copies to exactly match canonical repository manifests."""
    pairs, errors = _canonical_embedded_pairs(repo_root)
    for canonical, embedded in pairs:
        if not canonical.is_file():
            errors.append(f"{canonical}: canonical manifest source is missing")
            continue
        if not embedded.is_file():
            errors.append(f"{embedded}: generated embedded copy is missing")
            continue
        if canonical.read_bytes() != embedded.read_bytes():
            errors.append(
                f"{embedded}: embedded copy drifted from canonical source {canonical}"
            )
    return errors


def validate_repository(repo_root: Path = REPO_ROOT) -> list[str]:
    """Validate every canonical community manifest, registry YAML, and drift."""
    manifests_root = repo_root / "manifests"
    errors: list[str] = []
    yaml_paths = sorted(manifests_root.rglob("*.yaml")) + sorted(
        manifests_root.rglob("*.yml")
    )
    for path in yaml_paths:
        document, parse_errors = _load_yaml(path)
        errors.extend(parse_errors)
        if parse_errors:
            continue
        if path.name == "manifest.yaml":
            errors.extend(validate_manifest(path, manifests_root / "schema"))
        elif document is not None and not isinstance(document, dict):
            errors.append(f"{path}: expected a YAML mapping")
    errors.extend(check_embedded_copy_drift(repo_root))
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=REPO_ROOT,
        help="repository root (defaults to the validator's checkout)",
    )
    args = parser.parse_args(argv)
    errors = validate_repository(args.repo_root.resolve())
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("Manifest validation passed (v1/v2 schemas and embedded copies).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
