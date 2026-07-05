# Print Partner documentation

Print Partner is a self-hostable web workflow for **layered STL kits** — a base repo plus add-ons, role filament colors, exports by folder, and shop-floor checkoff. This folder holds user guides, examples, and technical references.

**Pipeline:** **Sources** → **Build** → **Review** → **Checkoff**

Plan management (create, rename, duplicate, delete) is separate from that pipeline — use the header **Create build** button, **Manage builds** on Build, or the **Builds** page in the sidebar.

---

## Get started

| Doc | Audience |
|-----|----------|
| [Install with Docker](INSTALL.md) | First-time Docker users — install, first run, data volume, troubleshooting |
| [Project site (landing page)](https://poitee.github.io/PrintPartnerPartner/) | Overview with workflow screenshots (light/dark) |
| [README (repo home)](../README.md) | Full feature list, quick start, env vars, monorepo layout |

After the app is running, open **Help** in the sidebar for the in-app workflow guide.

---

## Workflow guides

| Step | What you do |
|------|-------------|
| **Sources** | Register GitHub repos, local folders, or zips; categories; import rules; sync; global STL search; update-available badges |
| **Build** | Manage builds, attach base/add-on sources, pick STL files, set role filament colors (live previews), **Update build** when stale, kit/manifest options, export or share plan |
| **Review** | Validation summary by role and filament, 3D previews, quantity edits, **Export STLs** |
| **Checkoff** | Per-unit print progress, printable checklist, **Export missing STLs** |

**Tips:** **⌘K / Ctrl+K** command palette · collapsible sidebar · first-run **Progress** widget hides after one full pipeline pass

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
| [Architecture](ARCHITECTURE.md) | Monorepo layout, deploy modes, job runner, client-side STL previews |
| [HTTP API](API.md) | `/api/v1` discovery, auth, jobs, exports |
| [Deploy reference](../web/DEPLOY.md) | Docker Compose, env vars, SaaS (Postgres + S3 + OAuth) |
| [Spoolman integration](integrations/SPOOLMAN.md) | Filament inventory on Build; spool weights in Review / Checkoff |

---

## Screenshots

Workflow screenshots used by the [README](../README.md) and [project site](index.html):

- [Light theme](screenshots/light/)
- [Dark theme](screenshots/dark/)
