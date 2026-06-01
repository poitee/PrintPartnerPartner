# Spoolman integration

Print Partner can connect to an optional [Spoolman](https://github.com/Donkie/Spoolman) instance so you can pick filaments from your Spoolman catalog on **Build**, optionally override physical spools per part on **Review**, and see **read-only** spool remaining weights in **Review** and **Checkoff**.

**Spoolman is fully optional.** With no integration configured, Print Partner behaves exactly as before: no Spoolman panels, hints, or badges appear anywhere.

Spoolman does not need to run on the same machine as Print Partner. All HTTP calls go through the Print Partner **server** (the browser never talks to Spoolman directly).

## What you see when Spoolman is disabled

| Area | Behavior |
|------|----------|
| **Build** | Standard catalog/custom filament picker only; no Spoolman group or spool dropdown |
| **Review / Checkoff** | No spool badges or per-part spool controls |
| **Settings** | “Optional integrations” section is collapsed by default at the bottom of Settings |

## Prerequisites

1. **Spoolman running** and reachable on your LAN (default port is often **7912** — check your install).
2. Confirm Spoolman responds in a browser: `http://<host>:7912/api/v1/info` or `/api/v1/health`.

## Find your Spoolman URL

Use the Spoolman root URL **without** `/api/v1`:

```text
http://192.168.1.50:7912
```

Print Partner appends `/api/v1` when calling the REST API ([Spoolman REST API v1](https://donkie.github.io/Spoolman/)).

## Print Partner setup

1. Open **Settings → Optional integrations** (expand the collapsed section).
2. **Add Spoolman** — enter a friendly name and base URL.
3. Click **Test connection**. You should see a success message (version or status from Spoolman).
4. Under **Use for filament picker**, select the integration so Spoolman colors appear on **Build**.
5. Ensure the integration is **Enabled**.

Filament IDs are stored as `spoolman:{integrationId}:filament:{numericId}` so plans survive restarts.

## Build — role filaments

On **Build**, open the role filament picker. Spoolman filaments appear in a **Spoolman** group (vendor, material, color from Spoolman `color_hex`) only after you enable an integration for the picker.

Assign colors by role as usual; parts inherit the selected Spoolman filament.

When a Spoolman filament is selected and matching spools exist (remaining weight > 0), a second dropdown appears:

- **Any spool (inventory summary)** — Review/Checkoff show combined remaining weight across all spools for that filament.
- **Pick a spool** — e.g. `#3 · ~420 g · Shelf A` — parts store `spoolman:{integrationId}:spool:{id}` and Review shows only that spool’s remaining weight.

Changing the filament clears the spool selection. Re-running **Update build** keeps filament and spool assignments on existing parts.

If Spoolman is unreachable, Build still works; a subtle hint appears only in the role filament picker (not on every page).

## Review — per-part spool override (optional)

When Spoolman is enabled and a part uses a Spoolman filament with in-stock spools, an inline **Spool** dropdown may appear on that part row (desktop table and mobile cards). Parts without Spoolman filaments show nothing extra.

- **Role default** — matches the spool assigned for that part’s role on Build (or “any spool” if none was picked).
- **Any spool (summary)** — clears a part-specific spool so the badge shows combined inventory (only offered when the role has a specific spool).
- **Pick a spool** — overrides just this part; the remaining-weight badge updates after save.

Spoolman errors during Review do not block quantity changes, include/exclude, or Checkoff.

## Review / Checkoff — spool inventory (read-only)

When a part uses a Spoolman filament and matching spools exist in Spoolman, Review and Checkoff show a muted badge such as:

- `~420 g on spool #3` (single spool, or a selected spool on Build/Review)
- `2 spools · ~650 g (#3, #5)` (multiple spools when no specific spool is chosen)

No badge is shown when Spoolman is off, the filament is not from Spoolman, or no in-stock spools match.

Print Partner **does not** deduct weight when you mark units printed.

## Docker networking

| Scenario | Base URL example |
|----------|------------------|
| Spoolman on another machine | `http://192.168.x.x:7912` (LAN IP of Spoolman host; allow firewall) |
| Both on same host, Print Partner in Docker (Mac/Windows) | `http://host.docker.internal:7912` |
| Both on same host, Linux Docker | Host gateway IP, or add `extra_hosts` in Compose |

Example Compose snippet (Linux — adjust IP):

```yaml
services:
  print-partner:
    extra_hosts:
      - "spoolman-host:172.17.0.1"
```

Then use `http://spoolman-host:7912` as the base URL.

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Test connection fails | URL includes `http://`, correct port, Spoolman running, firewall |
| Connection refused from Docker | Use LAN IP or `host.docker.internal`, not `localhost` |
| Empty Spoolman picker | Integration enabled, selected under **Use for filament picker**, Spoolman has filaments |
| No spool badge in Review | Part must use a Spoolman filament id; spool must have remaining weight > 0 |
| No spool dropdown on Build | Spoolman filament selected but no spools with remaining weight for that filament in Spoolman |
| Stale UI after upgrade | Hard refresh the browser |

Test from the Print Partner container/host:

```bash
curl -s "http://YOUR_SPOOLMAN_HOST:7912/api/v1/health"
```

## API (automation)

Integrations use **`/api/v1`** only:

| Method | Path |
|--------|------|
| `POST` | `/api/v1/integrations/:id/test` |
| `GET` | `/api/v1/integrations/:id/spoolman/filaments` |
| `GET` | `/api/v1/integrations/:id/spoolman/spools` |

`GET /filaments/catalog` merges `spoolman_colors` when `default_spoolman_integration_id` is set (or pass `?spoolman_integration_id=`).

`PATCH /parts/:id` accepts `spoolman_spool_id` for per-part overrides.

See [API.md](../API.md) for auth and OpenAPI.

## Limitations (v1)

- **No automatic consumption** — marking units printed in Checkoff does not call Spoolman “Use Spool Filament” or deduct weight. A future optional “Suggest spool usage in Checkoff” toggle may be added; it will stay off by default.
- **No live sync** — no WebSocket or Moonraker push from Spoolman; weights refresh when Review/Checkoff reloads.
- Integrations API is `/api/v1` only; core workflow does not require Spoolman.
