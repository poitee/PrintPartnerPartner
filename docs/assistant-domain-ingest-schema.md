# Assistant domain ingest schema

Formats produced by the [research brief](./assistant-research-brief.md) and how Print Partner loads them for the **local** kit advisor.

**Not training.** Files are read at runtime into the system prompt and/or `get_source_docs` / notes.

---

## Mapping overview

| Research output | Ingest target | Consumed by |
|-----------------|---------------|-------------|
| `research/_global/alias_map.yaml` | `web/apps/server/src/data/assistant-domain/_global/alias_map.yaml` | System prompt domain pack |
| `research/_global/stacks.yaml` | `assistant-domain/_global/stacks.yaml` (+ optional merge into `kit-catalog.yaml` `stack_presets` after review) | System prompt; maintainer catalog edits |
| `research/_global/merge_conflicts.yaml` | `assistant-domain/_global/merge_conflicts.yaml` | System prompt domain pack |
| `research/_global/pitfalls.md` | `assistant-domain/_global/pitfalls.md` | System prompt (with hard-coded cheat sheet) |
| `research/<Source>/identity.yaml` + `compatibility.yaml` | `assistant-domain/sources/<SourceName>/` | Truncated per-source digest in prompt |
| `workflow.md` / `pitfalls.md` / `quotes.md` | `source_notes` or knowledge-bundle import | `get_source_docs` |
| `structure.yaml` | Proposals → `docs/path-hints.yaml` diffs | Matching / option groups (human review) |

Built-in loader path: `web/apps/server/src/data/assistant-domain/` (see `loadAssistantDomainPack()`).

Optional import: `POST /assistant/domain/import` with a research tree (or zip contents as JSON) copies `_global` + selected source digests into `assistant-domain/` and can create source notes when `source_name` matches an existing source.

---

## Per-source files

### `identity.yaml`

```yaml
source_name: Voron-Trident          # MUST match Print Partner source name / kit-catalog source_name
github_url: https://github.com/VoronDesign/Voron-Trident
default_branch: main
important_tags:
  - id: VTr2
    label: R2
    notes: Official Trident R2 release tag
  - id: VTr1
    label: R1
role: base                          # base | toolhead | probe | electronics | accents | other
upstream_of: null                   # or e.g. LDOVoronTrident is fork_of: Voron-Trident
fork_of: null
summary: Official Voron Trident printer kit
```

### `structure.yaml`

```yaml
source_name: Voron-Trident
required_path_globs:
  - "**/STLs/**"
optional_path_globs:
  - "**/Optional/**"
option_groups:
  - id: example_group
    label: Example variant
    rule: pick_one
    variants:
      - id: a
        path_contains: "/A/"
      - id: b
        path_contains: "/B/"
naming_quirks:
  - "[a]_ = accent role marker"
  - "_xN = quantity"
overlaps:
  - with_source: Voron-Stealthburner
    note: toolhead parts may collide by slug if both included wrongly
```

### `compatibility.yaml`

Canonical schema id: `print-partner/compat@1`.

**Entity roles (for the interaction graph):**

| Role | Examples | Notes |
|------|----------|--------|
| Printer family | `voron_2.4`, `voron_trident` | Catalog `printer_family` / base id |
| Base kit source | `Voron-Trident` @ `VTr2` | One plan base layer |
| Addon / mod source | `Voron-Tap`, `LDOVoronTrident` | Addon layer; may be fork (`fork_of`) or kit supplement |
| Slot | `toolhead`, `probe`, `extruder`, `z_endstop`, `power_inlet`, … | Exclusive concern (`replaces_slots` / catalog `replaces_slot`) |
| Part replacement | path/slug edges | Addon part supersedes base part |
| Stack | named recipe | Base + refs + addons + default selections |

Research `compat@1` and the older ingest sketch are both accepted by the loader (`normalizeCompatibility`):

| Canonical field | Also accepts |
|-----------------|--------------|
| `attaches_to_bases` (flat string list) | `attaches_to: [{base, ref?, path_scope?, note?}]` |
| `conflicts_with` | `conflicts` |
| `replaces_slots` | inferred from `kind` / prose |
| `replaces_parts` | structured edges; also heuristically parsed from prose `replaces` |

```yaml
schema: print-partner/compat@1
source_name: Voron-Tap
kind: addon_probe                    # base | addon_probe | addon_toolhead | …
attaches_to:
  - {base: Voron-2, ref: Voron2.4}
  - {base: Voron-Trident, ref: main/VTr2}
# Flat form also OK:
# attaches_to_bases: [Voron-2, Voron-Trident]
requirements:
  - "MGN-12H X axis"
not_for: [Voron-Switchwire, Voron-0]
replaces_slots: [probe, z_endstop]
replaces:
  - "stock X carriage"
  - "Voron-2 STLs/Z_Endstop/nozzle_probe.stl"
conflicts: [Klicky-Probe, Boop]      # or conflicts_with:
replaces_parts:                        # optional structured edges
  - from_source: Voron-Trident
    from_slug_or_path: z_endstop.stl
    to_slug_or_path: null
ldo_pairing: "…"                       # string or object; legacy: ldo_vs_stock
recommended_stacks: [ldo_trident_r2]
```

Runtime:

- Per-source digests in the system prompt include a compact `compat:` line (attaches / conflicts / slots / replaces_parts).
- `get_interaction_graph` / `check_stack_compatibility` execute the graph against catalog `pick_one` peers + `_global/merge_conflicts.yaml`.
- Kit catalog remains UI/preset SoT; domain pack is the rich graph. Maintainer check (`findCatalogDomainMismatches`) flags `pick_one` peers missing `conflicts_with` and divergent `stacks.yaml` vs `stack_presets`.

### `workflow.md` / `pitfalls.md` / `quotes.md`

Free markdown. Quotes must cite `path` + `tag` or commit. Mark unreliable text as untrusted.

---

## Global files

### `alias_map.yaml`

Canonical (nested) form:

```yaml
version: 1
aliases:
  - phrases:
      - "LDO Trident R2"
      - "ldo trident r2"
    resolve:
      catalog_base_id: voron_trident
      source_name: Voron-Trident
      tag: VTr2
      branch: null
      addons: [LDOVoronTrident]
      notes: Base is Voron-Trident @ VTr2 + LDO addons
```

Research-output shorthand is also accepted by the loader:

```yaml
schema: print-partner/aliases@1
aliases:
  - {phrase: "LDO Trident R2", source_name: Voron-Trident, ref: VTr2, addons: [LDOVoronTrident@master]}
```

`phrase` may contain ` / `-separated alternatives. `ref` maps to `tag` unless it is a known branch (`main`, `master`, `Voron2.4`, …).

### `stacks.yaml`

Canonical map form:

```yaml
version: 1
stacks:
  ldo_trident_r2:
    label: LDO Trident R2
    base_source: Voron-Trident
    base_tag: VTr2
    catalog_base_id: voron_trident
    addon_sources:
      - Voron-Stealthburner
      - Voron-Tap
    default_selections:
      toolhead: stealthburner
      probe: voron_tap
    notes: Sync Voron-Trident at VTr2 before Update build
```

Research-output array form is also accepted:

```yaml
schema: print-partner/stacks@1
stacks:
  - name: "LDO Trident R2"
    base: {source_name: Voron-Trident, ref: VTr2}
    addons:
      - {source_name: LDOVoronTrident, ref: master}
```

Align `addon_sources` / selection keys with [`kit-catalog.yaml`](./kit-catalog.yaml) when proposing catalog `stack_presets` merges.

### `merge_conflicts.yaml`

```yaml
version: 1
conflicts:
  - slug_or_path: example_bracket
    sources: [Voron-2, SomeAddon]
    resolution: Prefer addon layer order / exclude duplicate in Build
```

Research-output form (`id` / `paths` / `stacks`) is normalized to the fields above.

### `pitfalls.md`

Short bullets only (loaded nearly verbatim into the prompt, truncated).

---

## Runtime behavior

1. On each assistant chat, `buildAssistantSystemPrompt` appends a truncated **Domain pack** (~3–4k chars) from `loadAssistantDomainPack()`.
2. Alias hits are listed first so local models resolve user phrases to exact `source_name` + tag.
3. Per-source digests are capped; full prose stays in notes / synced docs via tools.
4. Empty / missing `assistant-domain/` is fine — prompt falls back to the hard-coded cheat sheet + kit catalog.

---

## Import API (server)

`POST /assistant/domain/import`

```json
{
  "global": {
    "alias_map": { "...": "..." },
    "stacks": { "...": "..." },
    "merge_conflicts": { "...": "..." },
    "pitfalls_md": "- bullet\n"
  },
  "sources": [
    {
      "source_name": "Voron-Trident",
      "identity": { },
      "compatibility": { },
      "notes": [
        { "title": "Workflow", "body_markdown": "..." }
      ]
    }
  ],
  "write_files": true
}
```

- `write_files: true` writes under `{PRINT_PARTNER_DATA_DIR}/assistant-domain/` (overrides shipped defaults for load order).
- `GET /assistant/domain` returns whether a pack loaded and a short preview.
- Matching `notes` create `source_notes` when a source with that `source_name` exists.

---

## Maintainer checklist

- [ ] Review alias_map phrases for collisions
- [ ] Diff stacks.yaml → kit-catalog `stack_presets` only after approval
- [ ] Diff structure.yaml → path-hints.yaml only after approval
- [ ] Sync sources at documented tags so PDF/README tools work
- [ ] Spot-check local Ollama answers for invented ids
