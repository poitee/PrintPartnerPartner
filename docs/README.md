# Print Partner documentation

Print Partner is a self-hostable **desk workflow** for layered STL kits — sync repos, compose a Build, pack plates, export, and check off prints. This folder holds user guides, examples, and technical references.

**Desk loop:** **Library** → **Builds** → **Sources** → **Plan** → **Checkoff** → **Production**

**New Build** asks only for a name, then opens Sources. Opening an existing Build opens Plan. Utility nav: Builds · Production · Printers · Settings.

**MCP attach:** connect Cursor / Grok / Claude to HTTP MCP on the live host. There is no in-app Kit Advisor. See [MCP attach](assistant-mcp.md) and [Kit brain](KIT_ADVISOR.md).

---

## Get started

| Doc | Audience |
|-----|----------|
| [Install with Docker](INSTALL.md) | First-time Docker / LAN host — install, first run, data volume, troubleshooting |
| [MCP attach](assistant-mcp.md) | HTTP MCP + Cursor plugin / Grok / Claude |
| [Kit brain](KIT_ADVISOR.md) | No in-app AI; confirm-to-apply via MCP |
| [Project site (landing page)](https://poitee.github.io/PrintPartnerPartner/) | Overview with workflow screenshots (light/dark) |
| [README (repo home)](../README.md) | Full feature list, quick start, MCP attach, env vars, monorepo layout |
| [Operations](../OPERATIONS.md) | Backups, API keys, metrics, day-two ops |

After the app is running, open **Help** in the sidebar for the in-app workflow guide.

---

## Workflow guides

| Step | Path | What you do |
|------|------|-------------|
| **Library** | `/library` | Register GitHub repos, local folders, or zips; categories; import rules; sync; global STL search; update-available badges |
| **Builds** | `/builds` | Name a Build, search, filter, archive, and restore |
| **Sources** | `/sources` | Attach base/add-on sources, pick STL files, set quantities and role filament colors |
| **Plan** | `/plan` | Review quantities and warnings, save a draft, and Apply so Checkoff and Production use the accepted list |
| **Checkoff** | `/progress` | Print checkoff — per-unit progress, assembled toggles, filters, printable checklist |
| **Production** | `/export?profile=` and `/production` | Assign units to Printers, arrange Plates, download revision-bound 3MFs, open a local slicer, send G-code |

**Tips:** **⌘K / Ctrl+K** command palette · collapsible spine · brand theme (light / dark / system)

### Playbooks

- [Build playbook — stack presets and variants](playbooks/kit-studio-build.md)
- [Author manifests on a stack](playbooks/author-manifest-on-stack.md)

### Examples

- [Golden LDO Voron 2.4 + SB Tap walkthrough](examples/golden-ldo-voron-2.4-sb-tap.md)
- [Export a golden kit bundle](examples/golden-ldo-voron-2.4-export.md)
- [Cross-source Voron golden stack](examples/cross-source-voron/ldo-2.4-golden-stack.md)

---

## Technical reference

| Doc | Contents |
|-----|----------|
| [Architecture](ARCHITECTURE.md) | Monorepo layout, deploy modes, job runner, MCP |
| [HTTP API](API.md) | `/api/v1` discovery, auth, jobs, exports, MCP |
| [Deploy reference](../web/DEPLOY.md) | Docker Compose, env vars, SaaS (Postgres + S3 + OAuth), MCP attach |
| [Spoolman integration](integrations/SPOOLMAN.md) | Filament inventory on Sources; spool weights in Plan and Checkoff |
| [Printer setup & debugging](integrations/PRINTER_SETUP.md) | Add Moonraker/PrusaLink, link fleet, send G-code, common failures |
| [Printer API research](integrations/PRINTER_APIS.md) | Klipper / Prusa / Bambu capability ladder and stance |
| [Printer UX deep dive](integrations/PRINTER_UX.md) | Desk-first screens, Production/Checkoff binds, phased UI map |
| [3MF export validation](3MF_EXPORT_VALIDATION.md) | Slicer import checklist for 3MF packs |
| [MCP attach](assistant-mcp.md) | HTTP MCP + Cursor / Grok / Claude connect |
| [Assistant research brief](assistant-research-brief.md) | Prompt/brief for producing domain research packs |
| [Domain ingest schema](assistant-domain-ingest-schema.md) | YAML/MD schemas for `assistant-domain/` packs |

---

## Screenshots

Workflow screenshots used by the [README](../README.md) and [project site](index.html):

- [Light theme](screenshots/light/)
- [Dark theme](screenshots/dark/)
- [How to capture](screenshots/README.md)
