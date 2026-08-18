from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from manifests.scripts.validate import check_embedded_copy_drift, validate_manifest


REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).parent / "fixtures"
SCHEMAS = REPO_ROOT / "manifests" / "schema"


class ManifestValidatorTests(unittest.TestCase):
    def test_accepts_valid_v1_and_v2_documents(self) -> None:
        for name in ("valid-v1.yaml", "valid-v2.yaml"):
            with self.subTest(name=name):
                self.assertEqual(validate_manifest(FIXTURES / name, SCHEMAS), [])

    def test_rejects_documents_against_their_versioned_schema(self) -> None:
        for name in ("invalid-v1.yaml", "invalid-v2.yaml"):
            with self.subTest(name=name):
                errors = validate_manifest(FIXTURES / name, SCHEMAS)
                self.assertTrue(errors, f"{name} unexpectedly passed validation")
                self.assertTrue(
                    any("schema validation failed" in error for error in errors),
                    errors,
                )

    def test_rejects_unsupported_manifest_versions(self) -> None:
        errors = validate_manifest(FIXTURES / "unsupported-v3.yaml", SCHEMAS)
        self.assertTrue(any("unsupported manifest version 3" in error for error in errors), errors)

    def test_detects_and_clears_embedded_copy_drift(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            canonical_manifest = (
                root / "manifests" / "community" / "example" / "manifest.yaml"
            )
            canonical_registry = root / "manifests" / "registry" / "index.yaml"
            embedded_dir = root / "web" / "apps" / "server" / "src" / "data" / "manifests"
            embedded_manifest = embedded_dir / "example.yaml"
            embedded_registry = embedded_dir / "registry-index.yaml"

            for path in (canonical_manifest, canonical_registry, embedded_manifest, embedded_registry):
                path.parent.mkdir(parents=True, exist_ok=True)
            canonical_manifest.write_text("format: print-partner-manifest\nversion: 1\n")
            canonical_registry.write_text("entries: []\n")
            embedded_manifest.write_text("format: print-partner-manifest\nversion: 2\n")
            embedded_registry.write_text("entries: []\n")

            errors = check_embedded_copy_drift(root)
            self.assertTrue(any("example.yaml" in error for error in errors), errors)

            embedded_manifest.write_bytes(canonical_manifest.read_bytes())
            self.assertEqual(check_embedded_copy_drift(root), [])

    def test_repository_embedded_copies_match_canonical_sources(self) -> None:
        self.assertEqual(check_embedded_copy_drift(REPO_ROOT), [])


if __name__ == "__main__":
    unittest.main()
