/** Shared workflow markdown shown in Help and injected into the AI advisor context. */
export const WORKFLOW_GUIDE = `# Print Partner workflow

Print Partner helps you manage **layered STL kits** — a base repo plus add-on repos — through a four-step pipeline: **Sources → Build → Review → Checkoff**. Plan management (create, rename, duplicate, delete) lives outside that pipeline — use the header **Create build** button, the **Manage builds** panel on Build, or the **Builds** page in the sidebar.

## Managing builds

Before you configure files and colors, create or select a **build plan**:

- **Header** — **Create build** (+ icon on mobile) and the plan picker (search, rename, duplicate, delete).
- **Build page** — collapsible **Manage builds** panel with the active-build dropdown and full CRUD.
- **Builds page** (sidebar under Settings) — same plan manager, always expanded.

The active plan is shared across Build, Review, and Checkoff. Switch plans in the header picker or **Manage builds** without reconfiguring each step separately.

## 1. Sources

Register GitHub repos, local folders, or zip archives. Assign **categories**, set **import rules** (which folders contain STLs), and **sync** to download files. The source library shows sync status and **update available** badges when upstream repos change. Use the global STL search box to find files by name or path across every synced repo.

## 2. Build

Open **Build** for the active plan:

- **Manage builds** — create or switch plans (see above).
- **Attach sources** — set a base layer and optional add-on layers from your source library.
- **Pick STL files** — expand each source card, check files or folders to include; selections save automatically.
- **Role filament colors** — assign a color per role (primary, accent, clear, opaque); previews update automatically on Build, Review, and Checkoff.
- **Kit manifest options** — apply stack presets and variant picks on the base source card when manifests are configured.
- **Update build** — recomputes parts from your file picks. A **stale build** banner appears when sources or selections changed; click **Update build** or enable **auto-recompute stale builds** in Settings.
- **Docs** — read synced repo README and Markdown inline from each source card.
- **Share build** — export a \`.print-partner-kit\` zip to share plan config (not STLs).
- **Export STLs** — export from Build or Review, grouped by color only or color + source directory.

## 3. Review

Confirm a **validation summary** grouped by role and filament. Browse the full included-parts list with **3D STL previews**, edit quantities, and fix issues (cards link back to Build when needed). **Export STLs** writes parts organized by role and folder structure.

## 4. Checkoff

Track **per-unit print progress** on the shop floor (saved per plan). Filter to missing or done parts, print an HTML checklist, and **Export missing STLs** for the next print batch. On-scroll **3D thumbnails** render client-side for each part.

## Tips

- **⌘K / Ctrl+K** — command palette for sync, recompute, exports, navigation, and **Manage builds**.
- **Theme** — light, dark, or system via the sidebar or header; the left sidebar can be **collapsed** to an icon rail (toggle at the bottom).
- **Progress widget** — the sidebar shows a first-run checklist until you complete Sources through Checkoff once; it then hides automatically.
- **Save / Import colors** — export role colors as JSON on Build; **Advanced** menu has reset and thumbnail recovery options.
- **Share build** — export plan config as a \`.print-partner-kit\` zip (not STLs).
- **Spoolman** — connect in Settings → Integrations for live filament inventory on Build and spool weights in Review / Checkoff. See the Spoolman integration doc in the repo.
- **API** — OpenAPI at \`/api/v1/openapi.json\` for automation; optional API key in self-host mode.
`;
