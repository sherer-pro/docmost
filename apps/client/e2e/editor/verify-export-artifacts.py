#!/usr/bin/env python3
"""Verify page-template/transclusion audit exports with local parsers only."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path
from typing import Any

import pdfplumber
from lxml import html as lxml_html

try:
    from markdown_it import MarkdownIt
except ModuleNotFoundError:
    MarkdownIt = None


FORBIDDEN_PRESENTATION_TOKENS = (
    "transclusionReference",
    "data-source-page-id",
    "data-transclusion-id",
)
EXPECTED_SYNCED_TEXT = (
    "Shared text",
    "Shared list",
    "Shared table",
    "Shared diagram",
)
EXPECTED_EDITOR_MERMAID_TEXT = (
    "Safe input",
    "Second line",
    "Validated?",
    "Rendered locally",
    "Visible error",
)
EXPECTED_TAG_LABELS = ("TBD", "TODO", "DONE", "Core", "Future", "Pilot")
DOCMOST_ARCHIVE_SCHEMA_VERSION = 5


def parse_markdown_token_count(content: str) -> int:
    if MarkdownIt is not None:
        return len(MarkdownIt("commonmark").parse(content))

    node = shutil.which("node")
    assert node, "Neither markdown-it-py nor Node.js markdown-it is available"
    script = """
import process from 'node:process';
import MarkdownIt from 'markdown-it';
let source = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) source += chunk;
process.stdout.write(String(new MarkdownIt('commonmark').parse(source).length));
"""
    result = subprocess.run(
        [node, "--input-type=module", "-e", script],
        input=content,
        text=True,
        capture_output=True,
        check=True,
    )
    return int(result.stdout)


def iter_nodes(value: Any):
    if not isinstance(value, dict):
        return
    yield value
    for child in value.get("content", []):
        yield from iter_nodes(child)


def verify_markdown(archive_path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(archive_path) as archive:
        names = [name for name in archive.namelist() if name.endswith(".md")]
        assert names, "Markdown export contains no .md document"
        content = "\n".join(
            archive.read(name).decode("utf-8", errors="strict") for name in names
        )
    for expected in EXPECTED_SYNCED_TEXT:
        assert expected in content, f"Markdown omits {expected}"
    for label in EXPECTED_TAG_LABELS:
        syntax = f"::tag[{label}]"
        assert syntax in content, f"Markdown omits tag syntax {syntax}"
    for forbidden in FORBIDDEN_PRESENTATION_TOKENS:
        assert forbidden not in content, f"Markdown leaks {forbidden}"
    assert not re.search(r"javascript\s*:", content, re.IGNORECASE)
    token_count = parse_markdown_token_count(content)
    assert token_count, "Markdown parser produced no document tokens"
    return {
        "files": names,
        "characters": len(content),
        "astTokens": token_count,
    }


def verify_html(archive_path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(archive_path) as archive:
        names = [name for name in archive.namelist() if name.endswith(".html")]
        assert names, "HTML export contains no .html document"
        documents = [
            lxml_html.fromstring(archive.read(name).decode("utf-8", errors="strict"))
            for name in names
        ]
    combined_text = " ".join(" ".join(document.itertext()) for document in documents)
    for expected in EXPECTED_SYNCED_TEXT:
        assert expected in combined_text, f"HTML omits {expected}"
    for label in EXPECTED_TAG_LABELS:
        assert label in combined_text, f"HTML omits tag label {label}"
    unsafe_urls: list[str] = []
    service_nodes: list[str] = []
    for document in documents:
        for element in document.iter():
            if element.attrib.get("data-type") == "transclusionReference":
                service_nodes.append("transclusionReference")
            for attribute in ("data-source-page-id", "data-transclusion-id"):
                if attribute in element.attrib:
                    service_nodes.append(attribute)
            for attribute in ("href", "src", "xlink:href"):
                value = element.attrib.get(attribute, "")
                if re.match(r"\s*javascript\s*:", value, re.IGNORECASE):
                    unsafe_urls.append(value)
            unsafe_urls.extend(
                f"{name}={value}"
                for name, value in element.attrib.items()
                if name.lower().startswith("on")
            )
    assert not service_nodes, f"HTML leaks service nodes: {service_nodes}"
    assert not unsafe_urls, f"HTML contains executable URLs/handlers: {unsafe_urls}"
    return {"files": names, "elements": sum(len(list(doc.iter())) for doc in documents)}


def verify_pdf(pdf_path: Path) -> dict[str, Any]:
    with pdfplumber.open(pdf_path) as pdf:
        assert pdf.pages, "PDF contains no pages"
        extracted = "\n".join(page.extract_text() or "" for page in pdf.pages)
        page_count = len(pdf.pages)
    for expected in EXPECTED_SYNCED_TEXT:
        assert expected in extracted, f"PDF text omits {expected}"
    for label in EXPECTED_TAG_LABELS:
        assert label in extracted, f"PDF text omits tag label {label}"
    for forbidden in FORBIDDEN_PRESENTATION_TOKENS:
        assert forbidden not in extracted, f"PDF leaks {forbidden}"
    return {"pages": page_count, "characters": len(extracted)}


def verify_editor_pdf(pdf_path: Path) -> dict[str, Any]:
    with pdfplumber.open(pdf_path) as pdf:
        assert pdf.pages, "Editor PDF contains no pages"
        extracted = "\n".join(page.extract_text() or "" for page in pdf.pages)
        page_count = len(pdf.pages)
    for expected in EXPECTED_EDITOR_MERMAID_TEXT:
        assert expected in extracted, f"Editor PDF omits Mermaid label {expected}"
    assert "flowchart TD" not in extracted, "Editor PDF retains raw Mermaid source"
    return {"pages": page_count, "characters": len(extracted)}


def verify_docmost(archive_path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(archive_path) as archive:
        manifest = json.loads(archive.read("docmost-metadata.json"))
        data = json.loads(archive.read("docmost-data.json"))
    manifest_version = manifest.get("schemaVersion")
    data_version = data.get("schemaVersion")
    assert manifest_version == DOCMOST_ARCHIVE_SCHEMA_VERSION, (
        "Docmost manifest schemaVersion must be "
        f"{DOCMOST_ARCHIVE_SCHEMA_VERSION}, got {manifest_version!r}"
    )
    assert data_version == DOCMOST_ARCHIVE_SCHEMA_VERSION, (
        "Docmost data schemaVersion must be "
        f"{DOCMOST_ARCHIVE_SCHEMA_VERSION}, got {data_version!r}"
    )
    page_ids = {page["id"] for page in data["pages"]}
    internal_references = 0
    external_references = 0
    tag_values: set[str] = set()
    snapshot_keys = {
        (
            snapshot.get("referencePageId"),
            snapshot["sourcePageId"],
            snapshot["transclusionId"],
        )
        for snapshot in data.get("transclusionSnapshots", [])
    }
    for page in data["pages"]:
        for node in iter_nodes(page["content"]):
            assert node.get("type") != "pageEmbed"
            if node.get("type") == "tag":
                tag_values.add(node.get("attrs", {}).get("value"))
            if node.get("type") != "transclusionReference":
                continue
            source_page_id = node.get("attrs", {}).get("sourcePageId")
            transclusion_id = node.get("attrs", {}).get("transclusionId")
            if source_page_id in page_ids:
                internal_references += 1
                continue
            external_references += 1
            assert (
                page["id"],
                source_page_id,
                transclusion_id,
            ) in snapshot_keys, "Archive contains a dangling foreign reference"
    assert tag_values == {
        "tbd",
        "todo",
        "done",
        "core",
        "future",
        "pilot",
    }, f"Archive tag values differ: {tag_values}"
    return {
        "pages": len(page_ids),
        "internalReferences": internal_references,
        "externalReferences": external_references,
        "snapshots": len(snapshot_keys),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audit_root", type=Path)
    args = parser.parse_args()
    audit_root = args.audit_root.resolve()
    downloads = audit_root / "downloads"
    report: dict[str, Any] = {"status": "PASS", "checks": {}}

    patterns = {
        "markdown": "*-synced-markdown-export.zip",
        "html": "*-synced-html-export.zip",
        "pdf": "*-synced-export.pdf",
        "docmost": "*-synced-docmost-export.zip",
        "editorPdf": "*-editor-export.pdf",
    }
    verifiers = {
        "markdown": verify_markdown,
        "html": verify_html,
        "pdf": verify_pdf,
        "docmost": verify_docmost,
        "editorPdf": verify_editor_pdf,
    }
    for kind, pattern in patterns.items():
        files = sorted(downloads.glob(pattern))
        assert files, f"No {kind} artifacts match {pattern}"
        report["checks"][kind] = {
            str(file.relative_to(audit_root)): verifiers[kind](file)
            for file in files
        }

    output = audit_root / "export-verification.json"
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
