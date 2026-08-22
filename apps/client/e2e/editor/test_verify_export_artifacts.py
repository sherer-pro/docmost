from __future__ import annotations

import importlib.util
import json
import re
import tempfile
import unittest
import zipfile
from pathlib import Path


VERIFIER_PATH = Path(__file__).with_name("verify-export-artifacts.py")
SPEC = importlib.util.spec_from_file_location("verify_export_artifacts", VERIFIER_PATH)
assert SPEC is not None and SPEC.loader is not None
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)

TAG_VALUES = ("tbd", "todo", "done", "core", "future", "pilot")


def archive_data(schema_version: int, extra_nodes: list[dict] | None = None) -> dict:
    tag_nodes = [
        {"type": "tag", "attrs": {"value": value}} for value in TAG_VALUES
    ]
    return {
        "schemaVersion": schema_version,
        "pages": [
            {
                "id": "page-1",
                "content": {
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [*tag_nodes, *(extra_nodes or [])],
                        }
                    ],
                },
            }
        ],
        "transclusionSnapshots": [],
    }


def write_archive(
    root: Path,
    *,
    manifest_version: int = 5,
    data_version: int = 5,
    extra_nodes: list[dict] | None = None,
) -> Path:
    archive_path = root / "docmost.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(
            "docmost-metadata.json",
            json.dumps({"schemaVersion": manifest_version}),
        )
        archive.writestr(
            "docmost-data.json",
            json.dumps(archive_data(data_version, extra_nodes)),
        )
    return archive_path


class VerifyDocmostArtifactTests(unittest.TestCase):
    def test_accepts_current_v5_archive(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            result = VERIFIER.verify_docmost(
                write_archive(Path(temporary_directory)),
            )

        self.assertEqual(
            result,
            {
                "pages": 1,
                "internalReferences": 0,
                "externalReferences": 0,
                "snapshots": 0,
            },
        )

    def test_rejects_legacy_manifest_and_data_versions(self) -> None:
        cases = (
            (4, 5, "Docmost manifest schemaVersion must be 5, got 4"),
            (5, 4, "Docmost data schemaVersion must be 5, got 4"),
        )
        for manifest_version, data_version, message in cases:
            with self.subTest(
                manifest_version=manifest_version,
                data_version=data_version,
            ):
                with tempfile.TemporaryDirectory() as temporary_directory:
                    archive_path = write_archive(
                        Path(temporary_directory),
                        manifest_version=manifest_version,
                        data_version=data_version,
                    )
                    with self.assertRaisesRegex(AssertionError, message):
                        VERIFIER.verify_docmost(archive_path)

    def test_rejects_page_embed_in_v5_archive(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            archive_path = write_archive(
                Path(temporary_directory),
                extra_nodes=[{"type": "pageEmbed", "attrs": {}}],
            )
            with self.assertRaises(AssertionError):
                VERIFIER.verify_docmost(archive_path)

    def test_verifier_version_matches_shared_archive_contract(self) -> None:
        contract_path = (
            Path(__file__).resolve().parents[4]
            / "packages"
            / "api-contract"
            / "src"
            / "docmost-archive.ts"
        )
        source = contract_path.read_text(encoding="utf-8")
        version_match = re.search(
            r"DOCMOST_ARCHIVE_SCHEMA_VERSION\s*=\s*(\d+)\s+as const",
            source,
        )

        self.assertIsNotNone(version_match)
        self.assertEqual(VERIFIER.DOCMOST_ARCHIVE_SCHEMA_VERSION, 5)
        self.assertEqual(
            VERIFIER.DOCMOST_ARCHIVE_SCHEMA_VERSION,
            int(version_match.group(1)),
        )


if __name__ == "__main__":
    unittest.main()
