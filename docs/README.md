# Print Partner documentation

Guides and references for running Print Partner on your LAN.

**Desk loop:** **Library** → **Builds** → **Sources** → **Plan** → **Checkoff** → **Production**

**New Build** asks only for a name, then opens Sources. Opening an existing Build opens Plan. Utility nav: Builds · Production · Printers · Settings.

---

## Start here

| Doc | Audience |
|-----|----------|
| [Install with Docker](INSTALL.md) | First-time Docker / LAN host |
| [MCP attach](assistant-mcp.md) | Connect Cursor, Grok, or Claude |
| [Kit brain](KIT_ADVISOR.md) | Confirm-to-apply MCP; no in-app AI |
| [Project site](https://poitee.github.io/PrintPartnerPartner/) | Overview with workflow screenshots |
| [README](../README.md) | Features, quick start, env vars |
| [Operations](OPERATIONS.md) | Backups, API keys, metrics |

After the app is running, open **Help** in the sidebar for the in-app workflow guide.

---

## Workflow

| Step | Path | What you do |
|------|------|-------------|
| **Library** | `/library` | Register GitHub repos, local folders, or zips; sync; import rules |
| **Builds** | `/builds` | Name a Build, search, filter, archive, and restore |
| **Sources** | `/sources` | Attach base/add-on sources, pick STL files, set quantities and colors |
| **Plan** | `/plan` | Review quantities and warnings, then Apply |
| **Checkoff** | `/progress` | Per-unit print checkoff and printable checklist |
| **Production** | `/export?profile=` and `/production` | Plates, 3MF downloads, local slicer, send G-code |

### Playbooks

- [Stack presets and variants](playbooks/kit-studio-build.md)
- [Author manifests on a stack](playbooks/author-manifest-on-stack.md)

### Examples

- [Golden LDO Voron 2.4 + SB Tap](examples/golden-ldo-voron-2.4-sb-tap.md)
- [Export a golden kit bundle](examples/golden-ldo-voron-2.4-export.md)
- [Cross-source Voron golden stack](examples/cross-source-voron/ldo-2.4-golden-stack.md)

---

## Reference

| Doc | Contents |
|-----|----------|
| [Architecture](ARCHITECTURE.md) | Monorepo, deploy modes, jobs, MCP |
| [HTTP API](API.md) | `/api/v1` discovery, auth, jobs, exports, MCP |
| [Deploy](../web/DEPLOY.md) | Docker Compose, env vars, SaaS |
| [Operations](OPERATIONS.md) | Backups, API keys, metrics |
| [Non-root setup](NON_ROOT_SETUP.md) | Bind-mount and uid notes |
| [Spoolman](integrations/SPOOLMAN.md) | Filament inventory on Sources |
| [Printer setup](integrations/PRINTER_SETUP.md) | Moonraker, PrusaLink, Bambu |
| [3MF export validation](3MF_EXPORT_VALIDATION.md) | Slicer import checklist |
| [MCP attach](assistant-mcp.md) | HTTP MCP connect |

---

## Screenshots

Used by the [README](../README.md) and [project site](index.html):

- [Light theme](screenshots/light/)
- [Dark theme](screenshots/dark/)
- [How to capture](screenshots/README.md)
