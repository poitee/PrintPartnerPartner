/** Shared workflow markdown shown in Help and injected into the AI advisor context. */
export const WORKFLOW_GUIDE = `# Print Partner workflow

Print Partner helps you manage **layered STL kits** — a base repo plus add-on repos — through **Library → Plan → Parts → Progress → Export**. Plan management stays in the sidebar plan picker (Active / Recent / Archived) plus Create plan under it. Rename, Duplicate, Delete, and Archive (when remaining = 0) live on the current plan’s overflow menu — not in the picker list.

## Managing plans

- **Plan picker** — switch the spine plan. Archived plans stay listed as templates; selecting one does not unarchive. Duplicate an archived template for the next customer.
- **Create plan** — under the picker in the sidebar.
- **Plan overflow** — Rename, Duplicate, Delete; Archive only when print remaining is 0.

The active plan is shared across Plan, Parts, Progress, and Export.

## 1. Sources

Register GitHub repos, local folders, or zip archives. Assign **categories**, set **import rules** (which folders contain STLs), and **sync** to download files. The source library shows sync status and **update available** badges when upstream repos change. Use the global STL search box to find files by name or path across every synced repo.

## 2. Plan

Open **Plan** for the active plan:

- **Attach sources** — set a base layer and optional add-on layers from your source library.
- **Pick STL files** — expand each source card, check files or folders to include; selections save automatically.
- **Role filament colors** — assign a color per role (primary, accent, clear, opaque); previews update automatically on Plan, Parts, and Progress.
- **Kit manifest options** — apply stack presets and variant picks on the base source card when manifests are configured.
- **Update build** — recomputes parts from your file picks. A **stale build** banner appears when sources or selections changed; click **Update build** or enable **auto-recompute stale builds** in Settings.
- **Docs** — read synced repo README and Markdown inline from each source card.
- **Share build** — export a \`.print-partner-kit\` zip to share plan config (not STLs).
- **Export STLs** — export from Plan or Parts, grouped by color only or color + source directory.

## 3. Parts

Confirm a **validation summary** grouped by role and filament. Browse the full included-parts list with **3D STL previews**, edit quantities, and fix issues (cards link back to Plan when needed). **Export STLs** writes parts organized by role and folder structure.

## 4. Progress

Track **per-unit print progress** on the shop floor (saved per plan). Filter to remaining or done parts, search, print an HTML checklist, and **Export remaining** STL units from this plan's checkoff for the next print batch. On-scroll **3D thumbnails** render client-side for each part.

## Tips

- **⌘K / Ctrl+K** — command palette for sync, recompute, exports, and navigation.
- **Theme** — light, dark, or system via the sidebar or header; the left sidebar can be **collapsed** to an icon rail (toggle at the bottom).
- **Progress widget** — the sidebar shows a first-run checklist until you complete Sources through Progress once; it then hides automatically.
- **Save / Import colors** — export role colors as JSON on Plan; **Advanced** menu has reset and thumbnail recovery options.
- **Share build** — export plan config as a \`.print-partner-kit\` zip (not STLs).
- **Spoolman** — connect in Settings → Integrations for live filament inventory on Plan and spool weights in Parts / Progress. See the Spoolman integration doc in the repo.
- **API** — OpenAPI at \`/api/v1/openapi.json\` for automation; optional API key in self-host mode.
`;;
