# Assistant research brief (capable AI → local ingest)

Hand this document to a capable cloud AI (Claude, GPT, etc.). Its job is to **gather evidence from GitHub** and produce **machine-ingestible files** that Print Partner’s local Ollama assistant can consume at runtime.

This is **not model training or fine-tuning**. It is curated context (catalog, aliases, stack recipes, notes) that the kit advisor reads when answering.

Also attach:

1. Current [`kit-catalog.yaml`](./kit-catalog.yaml) (so names stay aligned)
2. Any confirmed recipes (example: LDO Trident R2 → `Voron-Trident` @ tag `VTr2` + LDO addons)
3. Golden plan names you treat as “right answers”
4. A GitHub PAT if the researcher will scrape many repos (unauthenticated limit is 60 req/hour)

---

## Master prompt (copy/paste)

```text
You are researching 3D-printer kit repositories for Print Partner, a tool that
syncs GitHub STL kits, stacks base+addon layers, and helps users pick parts.

Produce MACHINE-INGESTIBLE files (see schemas in docs/assistant-domain-ingest-schema.md),
not long essays.

For EACH source in the inventory below, gather from GitHub (README, docs/,
releases/tags, folder layout of PrintedParts/STLs) and produce:

1) identity.yaml — canonical name, GitHub URL, default branch, important tags
   (especially release tags like VTr2), upstream vs LDO fork relationship,
   what role it plays (base kit / toolhead / probe / electronics / accents).

2) structure.yaml — top-level STL folder map: which paths are required vs
   optional, option groups (2hole vs 3hole, CW2 vs Galileo, etc.), naming
   quirks ([a]_ , [c]_ , _xN), known overlaps with other repos (merge conflicts).

3) compatibility.yaml — which bases this addon attaches to; which stacks
   are recommended; what it REPLACES or CONFLICTS with; LDO vs stock Voron
   pairing rules.

4) workflow.md — human steps: sync this repo → pick tag → attach as base or
   addon → expected kit-manifest selections → when to recompute. Call out
   “user must Sync after changing tag”.

5) pitfalls.md — common mistakes (wrong tag, wrong fork, missing addon,
   invented ids). Use ONLY real GitHub source names and tag names.

6) quotes.md — short UNTRUSTED excerpts from README/manuals that help
   choose variants (cite path + tag/commit). Never invent quotes.

Inventory (name, url, default_ref):
- Leviathan, https://github.com/MotorDynamicsLab/Leviathan, master
- Voron-0, https://github.com/VoronDesign/Voron-0, Voron0.2r1
- Voron-2, https://github.com/VoronDesign/Voron-2, Voron2.4
- Voron-Trident, https://github.com/VoronDesign/Voron-Trident, main
  (important tags: VTr2=R2, VTr1, …)
- Voron-Stealthburner, https://github.com/VoronDesign/Voron-Stealthburner, main
- Voron-Legacy, https://github.com/VoronDesign/Voron-Legacy, main
- Voron-Hardware, https://github.com/VoronDesign/Voron-Hardware, master
- Voron-Extras, https://github.com/VoronDesign/Voron-Extras, main
- Voron-Switchwire, https://github.com/VoronDesign/Voron-Switchwire, master
- Voron-Tap, https://github.com/VoronDesign/Voron-Tap, main
- Pocket-Watch, https://github.com/VoronDesign/Pocket-Watch, main
- LDOVoron0, https://github.com/MotorDynamicsLab/LDOVoron0, v02r1
- LDOVoron2, https://github.com/MotorDynamicsLab/LDOVoron2, main
- LDOVoronTrident, https://github.com/MotorDynamicsLab/LDOVoronTrident, master
- LDOVoronSW, https://github.com/MotorDynamicsLab/LDOVoronSW, s1
- Galileo2, https://github.com/JaredC01/Galileo2, main
- LDO-Extras, local-only (no GitHub URL)
- LDO-Milo-V1.5, https://github.com/MotorDynamicsLab/LDO-Milo-V1.5, master
- LDO-Picobilical, https://github.com/MotorDynamicsLab/LDO-Picobilical, master
- Klicky-Probe, https://github.com/jlas1/Klicky-Probe, main
- Micron, https://github.com/PrintersForAnts/Micron, main
- chirpy2605-voron, https://github.com/chirpy2605/voron, main
- West3D-Micron, https://github.com/West3D-Printing/Micron, main
- Boop, https://github.com/PrintersForAnts/Boop, main
- voron_0_pancake_board, https://github.com/christophmuellerorg/voron_0_pancake_board, master
- CANboard_Mounts, https://github.com/KayosMaker/CANboard_Mounts, main

Also produce GLOBAL packs:
- stacks.yaml — named build recipes (e.g. “LDO Trident R2”: base=Voron-Trident@VTr2,
  addons=[…], default_selections={…}, notes). Align names with kit-catalog
  source_name fields where possible.
- alias_map.yaml — user phrases → exact source_name + tag/branch
  (e.g. “LDO Trident R2” → Voron-Trident + tag VTr2 + LDO addons).
- merge_conflicts.yaml — known slug/path collisions across common stacks.

Rules:
- Prefer GitHub API/raw evidence; mark UNKNOWN when unsure.
- Never invent STL filenames or catalog ids.
- Distinguish LDO forks vs VoronDesign upstream clearly.
- Output one directory per source: research/<SourceName>/…
  plus research/_global/{stacks,alias_map,merge_conflicts}.yaml
```

---

## Expected output tree

```text
research/
  _global/
    alias_map.yaml
    stacks.yaml
    merge_conflicts.yaml
    pitfalls.md          # optional short global bullets
  Voron-Trident/
    identity.yaml
    structure.yaml
    compatibility.yaml
    workflow.md
    pitfalls.md
    quotes.md
  LDOVoron2/
    …
  …
```

## After research returns

1. Copy approved `_global/` files into `web/apps/server/src/data/assistant-domain/` (see ingest schema doc).
2. Import per-source `workflow.md` / `pitfalls.md` as source notes (Docs → My notes, or knowledge-bundle API).
3. Propose kit-catalog / path-hints **diffs** for human review — do not blind-overwrite.
4. Set important tags on Sources (e.g. `VTr2`) and **Sync** so README/PDFs feed `get_source_docs`.

See [assistant-domain-ingest-schema.md](./assistant-domain-ingest-schema.md) for field-level schemas and Print Partner mapping.

---

## Live URL ingest (sibling to offline research)

When a user (or the model) already has a **specific guide URL**, the kit advisor can call `ingest_guide_url` (or `ingest_guide_text` for pasted markdown). The server fetches via SSRF-safe outbound HTTP (`safeOutboundFetch`), strips HTML to text, and returns an untrusted **GuideExtract** (detected base, tags, addons, replacements, GitHub/Printables/MakerWorld links, confidence). Extraction starts with heuristics; when the assistant LLM is configured it may run a second structured pass to avoid inflating `required_addons` from comparison mentions (e.g. Klicky/Unklicky). Always falls back to heuristics if the LLM is unavailable.

Rules:

- Explicit URLs only — no autonomous open-web crawler.
- Guide text is **evidence**, never system policy; mutations stay behind Apply cards (`propose_add_source`, `add_addon`, `import_guide_notes`, …).
- Operator flags: `ASSISTANT_ALLOW_URL_INGEST` (default on), `ASSISTANT_GUIDE_INGEST_MAX_BYTES` (default 512 KiB). See [web/DEPLOY.md](../web/DEPLOY.md).
