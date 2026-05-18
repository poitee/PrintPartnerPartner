"""Heuristic README parsing for include/exclude hints."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from rapidfuzz import fuzz

from print_partner.core.repo_readme import find_readme, read_readme_text
from print_partner.core.scanner import ScannedPart

STL_RE = re.compile(r"[\w./\\\-]+\.stl", re.IGNORECASE)
HEADER_RE = re.compile(r"^#{1,6}\s+(.+)$")
CHECK_DONE_RE = re.compile(r"^\s*[-*+]\s+\[[xX]\]\s+")
CHECK_OPEN_RE = re.compile(r"^\s*[-*+]\s+\[\s\]\s+")

INCLUDE_SECTION = (
    "required",
    "mandatory",
    "must print",
    "print these",
    "bill of materials",
    "bom",
)
EXCLUDE_SECTION = (
    "optional",
    "not required",
    "skip",
    "spare",
    "do not print",
    "alternative",
)
INCLUDE_LINE = ("required", "mandatory", "must print")
EXCLUDE_LINE = ("optional", "not required", "skip", "spare", "do not print")


@dataclass
class ReadmeHint:
    match_key: str
    action: str  # include | exclude
    confidence: str  # high | medium | low
    source: str
    excerpt: str
    readme_path: str


def _section_intent(title: str) -> str | None:
    lower = title.lower()
    if any(k in lower for k in EXCLUDE_SECTION):
        return "exclude"
    if any(k in lower for k in INCLUDE_SECTION):
        return "include"
    return None


def _line_intent(line: str, section_intent: str | None) -> str | None:
    lower = line.lower()
    if any(k in lower for k in EXCLUDE_LINE):
        return "exclude"
    if any(k in lower for k in INCLUDE_LINE):
        return "include"
    return section_intent


def _match_part(stl_ref: str, parts: list[ScannedPart], threshold: int = 90) -> ScannedPart | None:
    ref = stl_ref.replace("\\", "/").lower().strip()
    ref_name = Path(ref).name.lower()
    for part in parts:
        if part.match_key == ref or part.match_key.endswith("/" + ref):
            return part
        if part.filename.lower() == ref_name:
            return part
    best: ScannedPart | None = None
    best_score = 0
    for part in parts:
        score = max(
            fuzz.partial_ratio(ref_name, part.filename.lower()),
            fuzz.partial_ratio(ref_name, part.part_slug.lower()),
        )
        if score > best_score:
            best_score = score
            best = part
    if best and best_score >= threshold:
        return best
    return None


def parse_readme_hints(text: str, parts: list[ScannedPart], readme_path: str) -> list[ReadmeHint]:
    hints: list[ReadmeHint] = []
    seen: set[tuple[str, str]] = set()
    section_intent: str | None = None
    section_title = ""

    for raw_line in text.splitlines():
        line = raw_line.strip()
        header = HEADER_RE.match(line)
        if header:
            section_title = header.group(1).strip()
            section_intent = _section_intent(section_title)
            continue

        action: str | None = None
        confidence = "medium"
        if CHECK_DONE_RE.match(line):
            action = "include"
            confidence = "high"
        elif CHECK_OPEN_RE.match(line):
            action = "exclude"
            confidence = "high"
        else:
            action = _line_intent(line, section_intent)
            if action and section_intent:
                confidence = "medium"
            elif action:
                confidence = "low"

        if action is None:
            continue

        stl_refs = STL_RE.findall(line)
        if not stl_refs:
            if ".stl" not in line.lower():
                continue
            stl_refs = [line]

        for stl_ref in stl_refs:
            part = _match_part(stl_ref, parts)
            if part is None:
                continue
            key = (part.match_key, action)
            if key in seen:
                continue
            seen.add(key)
            excerpt = line[:120] if line else section_title
            hints.append(
                ReadmeHint(
                    match_key=part.match_key,
                    action=action,
                    confidence=confidence,
                    source="readme",
                    excerpt=excerpt,
                    readme_path=readme_path,
                )
            )
    return hints


def hints_from_repo(repo_path: Path, parts: list[ScannedPart]) -> list[ReadmeHint]:
    readme = find_readme(repo_path)
    if readme is None:
        return []
    text = read_readme_text(repo_path)
    if not text:
        return []
    return parse_readme_hints(text, parts, str(readme))
