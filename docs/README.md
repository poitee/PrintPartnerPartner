# Print Partner documentation

Print Partner is a self-hostable web workflow for **layered STL kits** — a base repo plus add-ons, role filament colors, exports by folder, and shop-floor checkoff. This folder holds user guides, examples, and technical references.

**Pipeline:** **Library** → **Plan** → **Parts** → **Progress** (print checkoff lives on Progress; legacy `/checkoff` redirects there)

Plan management (create, rename, duplicate, delete) is separate from that pipeline — use the header **Create build** button, **Manage builds** on Plan, or the **Builds** page in the sidebar.

**MCP attach:** connect Cursor / Grok / Claude to HTTP MCP on the live host. See [MCP attach](assistant-mcp.md) and [Kit brain](KIT_ADVISOR.md).

---

## Get started

| Doc | Audience |
|-----|----------|
| [Install with Docker](INSTALL.md) | First-time Docker users — install, first run, data volume, troubleshooting |
| [MCP attach](assistant-mcp.md) | HTTP MCP + Cursor plugin / Grok / Claude |
| [Kit brain](KIT_ADVISOR.md) | No in-app AI; confirm-to-apply via MCP |
| [Project site (landing page)](https://poitee.github.io/PrintPartnerPartner/) | Overview with workflow + AI screenshots (light/dark) |
| [README (repo home)](../README.md) | Full feature list, quick start, MCP attach, env vars, monorepo layout |

After the app is running, open **Help** in the sidebar for the in-app workflow guide.

---

## Workflow guides

| Step | What you do |
|------|-------------|
| **Library** | Register GitHub repos, local folders, or zips; categories; import rules; sync; global STL search; update-available badges |
| **Plan** | Manage builds, attach base/add-on sources, pick STL files, set role filament colors (live previews), **Update build** when stale, kit/manifest options, export or share plan |
| **Parts** | Validation summary by role and filament, 3D previews, quantity edits, **Export STLs** / 3MF, **Export missing STLs** |
| **Progress** | Print checkoff — per-unit progress, filters, printable checklist |

**Tips:** **⌘K / Ctrl+K** command palette · collapsible sidebar · header **Advisor** when AI is enabled · first-run **Progress** widget hides after one full pipeline pass

### Playbooks

- [Build playbook — stack presets and variants](playbooks/kit-studio-build.md)
- [Author manifests on a stack](playbooks/author-manifest-on-stack.md)

### Examples

- [Golden LDO Voron 2.4 + SB Tap walkthrough](examples/golden-ldo-voron-2.4-sb-tap.md)
- [Export paths from Review and Checkoff](examples/golden-ldo-voron-2.4-export.md)
- [Cross-source Voron golden stack](examples/cross-source-voron/ldo-2.4-golden-stack.md)

---

## Technical reference

| Doc | Contents |
|-----|----------|
| [Architecture](ARCHITECTURE.md) | Monorepo layout, deploy modes, job runner, kit advisor overview |
| [HTTP API](API.md) | `/api/v1` discovery, auth, jobs, exports, `/assistant/*` |
| [Deploy reference](../web/DEPLOY.md) | Docker Compose, env vars, SaaS (Postgres + S3 + OAuth), Settings vs env for AI |
| [Spoolman integration](integrations/SPOOLMAN.md) | Filament inventory on Plan; spool weights in Parts |
| [Printer setup & debugging](integrations/PRINTER_SETUP.md) | Add Moonraker/PrusaLink, link fleet, send G-code, common failures |
| [Printer API research](integrations/PRINTER_APIS.md) | Klipper / Prusa / Bambu capability ladder and stance |
| [Printer UX deep dive](integrations/PRINTER_UX.md) | Desk-first screens, Export/Progress binds, phased A→F UI map |
| [3MF export validation](3MF_EXPORT_VALIDATION.md) | Slicer import checklist for 3MF packs |
| [MCP attach](assistant-mcp.md) | HTTP MCP + Cursor / Grok / Claude connect |
| [Assistant research brief](assistant-research-brief.md) | Prompt/brief for producing domain research packs |
| [Domain ingest schema](assistant-domain-ingest-schema.md) | YAML/MD schemas for `assistant-domain/` packs |

---

## Screenshots

Workflow and AI screenshots used by the [README](../README.md) and [project site](index.html):

- [Light theme](screenshots/light/)
- [Dark theme](screenshots/dark/)
- [How to capture](screenshots/README.md)
