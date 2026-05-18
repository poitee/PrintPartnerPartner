"""Cross-layer and README suggestions for parts curation."""

from __future__ import annotations

from dataclasses import dataclass

from rapidfuzz import fuzz

from print_partner.core.readme_hints import ReadmeHint
from print_partner.core.scanner import ScannedPart

DEFAULT_FUZZY_THRESHOLD = 85


@dataclass
class ReferencePart:
    match_key: str
    part_slug: str
    filename: str
    included: bool
    layer_label: str


@dataclass
class Suggestion:
    kind: str
    action: str  # include | exclude
    target_match_key: str
    reference_match_key: str
    reference_layer: str
    score: float
    reason: str
    source: str  # readme | cross-layer


def _reference_parts_from_layers(
    reference_layers: list[tuple[str, list[ScannedPart], set[str]]],
) -> list[ReferencePart]:
    refs: list[ReferencePart] = []
    for layer_label, scanned, included_keys in reference_layers:
        for part in scanned:
            refs.append(
                ReferencePart(
                    match_key=part.match_key,
                    part_slug=part.part_slug,
                    filename=part.filename,
                    included=part.match_key in included_keys,
                    layer_label=layer_label,
                )
            )
    return refs


def _best_ref_match(
    part: ScannedPart, refs: list[ReferencePart], threshold: float
) -> tuple[ReferencePart | None, float]:
    best: ReferencePart | None = None
    best_score = 0.0
    for ref in refs:
        if part.match_key == ref.match_key:
            return ref, 100.0
        score = float(fuzz.ratio(part.part_slug.lower(), ref.part_slug.lower()))
        if score > best_score:
            best_score = score
            best = ref
    if best and best_score >= threshold:
        return best, best_score
    return None, 0.0


def _cross_layer_suggestions(
    parts: list[ScannedPart],
    included: set[str],
    refs: list[ReferencePart],
    threshold: float,
) -> list[Suggestion]:
    out: list[Suggestion] = []
    seen: set[tuple[str, str]] = set()

    for part in parts:
        current_included = part.match_key in included
        ref, score = _best_ref_match(part, refs, threshold)
        if ref is None:
            continue

        action: str | None = None
        kind = ""
        if part.match_key == ref.match_key:
            if current_included and ref.included:
                action, kind = "exclude", "exclude_replaces_included"
            elif current_included and not ref.included:
                action, kind = "exclude", "exclude_mirror_excluded"
            elif not current_included and ref.included:
                action, kind = "include", "include_mirror_included"
        else:
            if current_included and ref.included:
                action, kind = "exclude", "exclude_fuzzy_duplicate"
            elif current_included and not ref.included:
                action, kind = "exclude", "exclude_mirror_excluded"
            elif not current_included and ref.included:
                action, kind = "include", "include_mirror_included"

        if action is None:
            continue
        if action == "exclude" and not current_included:
            continue
        if action == "include" and current_included:
            continue

        key = (part.match_key, action)
        if key in seen:
            continue
        seen.add(key)

        reason = f"{kind}: {ref.layer_label} — {ref.filename} ({score:.0f}%)"
        out.append(
            Suggestion(
                kind=kind,
                action=action,
                target_match_key=part.match_key,
                reference_match_key=ref.match_key,
                reference_layer=ref.layer_label,
                score=score,
                reason=reason,
                source="cross-layer",
            )
        )
    return out


def _readme_suggestions(
    included: set[str],
    readme_hints: list[ReadmeHint],
) -> list[Suggestion]:
    out: list[Suggestion] = []
    seen: set[tuple[str, str]] = set()
    for hint in readme_hints:
        current_included = hint.match_key in included
        if hint.action == "include" and current_included:
            continue
        if hint.action == "exclude" and not current_included:
            continue
        key = (hint.match_key, hint.action)
        if key in seen:
            continue
        seen.add(key)
        score = 100.0 if hint.confidence == "high" else 80.0 if hint.confidence == "medium" else 60.0
        out.append(
            Suggestion(
                kind=f"readme_{hint.action}",
                action=hint.action,
                target_match_key=hint.match_key,
                reference_match_key="",
                reference_layer="README",
                score=score,
                reason=f"README ({hint.confidence}): {hint.excerpt[:80]}",
                source="readme",
            )
        )
    return out


def _dedupe_suggestions(suggestions: list[Suggestion]) -> list[Suggestion]:
    merged: dict[tuple[str, str], Suggestion] = {}
    for sug in suggestions:
        key = (sug.target_match_key, sug.action)
        existing = merged.get(key)
        if existing is None:
            merged[key] = sug
            continue
        if sug.source == "readme" and existing.source == "cross-layer":
            merged[key] = Suggestion(
                kind=sug.kind,
                action=sug.action,
                target_match_key=sug.target_match_key,
                reference_match_key=existing.reference_match_key,
                reference_layer=existing.reference_layer,
                score=max(sug.score, existing.score),
                reason=f"{sug.reason}; {existing.reason}",
                source="readme",
            )
        elif sug.score > existing.score:
            merged[key] = sug
    return list(merged.values())


def build_suggestions(
    parts: list[ScannedPart],
    included: set[str],
    *,
    reference_layers: list[tuple[str, list[ScannedPart], set[str]]] | None = None,
    readme_hints: list[ReadmeHint] | None = None,
    fuzzy_threshold: float = DEFAULT_FUZZY_THRESHOLD,
) -> list[Suggestion]:
    all_suggestions: list[Suggestion] = []
    if readme_hints:
        all_suggestions.extend(_readme_suggestions(included, readme_hints))
    if reference_layers:
        refs = _reference_parts_from_layers(reference_layers)
        all_suggestions.extend(_cross_layer_suggestions(parts, included, refs, fuzzy_threshold))

    deduped = _dedupe_suggestions(all_suggestions)

    def sort_key(s: Suggestion) -> tuple[int, float]:
        readme_priority = 0 if s.source == "readme" and s.score >= 80 else 1
        return (readme_priority, -s.score)

    return sorted(deduped, key=sort_key)
