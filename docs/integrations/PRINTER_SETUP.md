# Printer setup & debugging (desk-first)

How to connect Moonraker / PrusaLink / Bambu (status) hosts, link them to fleet machines, send sliced G-code from Export (Moonraker/PrusaLink), and open Progress verify when a host job finishes. Product UX: [PRINTER_UX.md](PRINTER_UX.md). Vendor APIs: [PRINTER_APIS.md](PRINTER_APIS.md).

**Phases A–F (desk-first self-host):** Settings hosts + fleet bind + status pill; Export **Send to printer** + JobTray `printer-upload` (Moonraker/PrusaLink); Progress **live strip** + active **send queue**; **verify-first Progress** on successful job complete (confirm/reject); **Bambu LAN MQTT status** (Phase E); thin **Queue for idle** / Send ready (Phase F); **Bambu Connect handoff** (official `bambu-connect://` URL — no MQTT print-start).

---

## Add a Moonraker host

1. Open **Settings → Printer hosts**.
2. Type **Moonraker**, name (e.g. `Shop Voron`), base URL (`http://192.168.1.40:7125` — no trailing slash required).
3. Optional API key / JWT if Moonraker is not in trusted-client mode (`X-Api-Key` / Bearer).
4. **Add host** → **Test connection**. Expect `Connected (klippy: ready)` (or `startup` / `error` if Klippy is not ready yet).

## Add a PrusaLink host

1. Same card → type **PrusaLink**.
2. Base URL is usually the printer’s LAN address (`http://192.168.1.50`).
3. Digest **username** (often blank on Buddy) and **password** = the printer Network API key.
4. Test → toast with printer name/state from `/api/v1/info` or `/api/v1/status`.

Secrets are stored with integrations redaction (`****` in list responses). Never paste keys into JobTray labels or screenshots.

## Add a Bambu host (LAN status)

1. Same card → type **Bambu (LAN status)**.
2. **Name** (e.g. `X1C desk`), **Printer IP / hostname**, **LAN access code**, **Serial / device id**.
3. Enable **LAN mode** on the printer (Network settings). Without LAN mode, MQTT `:8883` is typically **connection refused**.
4. Find the **access code** and **serial** on the printer Network / LAN screen (or Bambu Studio device info). MQTT auth is username `bblp` + access code as password.
5. **Add host** → **Test connection**. Expect `Connected (LAN MQTT · Idle)` (or Printing / … from `gcode_state`).
6. Link the host on **Printer fleet** — Progress **live strip** and fleet status pill use the same `GET /api/v1/integrations/:id/status` poll as Moonraker/PrusaLink.

**What works today:** status / progress / ETA / filename via local MQTT TLS (`mqtts://IP:8883`); Export **Open in Bambu Connect** stages a sliced `.3mf` / `.gcode` and hands off via the official `bambu-connect://import-file` URL scheme (desk self-host can launch Connect; Docker users download the staged file or set `BAMBU_CONNECT_HOST_PATH_MAP`).

**What does not ship:** reverse-engineered MQTT print-start. Moonraker / PrusaLink keep direct G-code upload on the same Export card.

**Docker / path map:** when the API runs in a container, Connect on the host cannot see container paths. Either download from the handoff response, or set `BAMBU_CONNECT_HOST_PATH_MAP=/data=/host/path/to/data` so the Connect URL uses the host mount path. Optional `BAMBU_CONNECT_LAUNCH=0|1` forces skip/force of OS URL launch.

**Not in desk-v1:** Local Server / Fleet Hub SDK (requires Bambu access application).

### Bambu debugging

| Symptom | Likely cause | What to check |
|---------|--------------|---------------|
| Test: `host … is required` | Empty IP | Paste LAN IP (no `http://`, no `:8883`) |
| Test: `access_code is required` | Missing / redacted code | Re-enter access code (list API shows `****`) |
| Test: `serial … is required` | Missing device SN | Copy serial from printer / Studio |
| Connection refused / closed | LAN mode off, wrong IP, firewall | Enable LAN mode; ping printer from the Print Partner host; open TCP `8883` |
| TLS / cert errors | Self-signed printer cert | For **private IP literals** the adapter skips cert verification (self-signed v1 cert). Prefer entering the printer’s LAN IP. Hostnames keep TLS verification on |
| Connects but no status / timeout | Wrong serial, wrong code | Confirm serial matches MQTT topic `device/{serial}/report`; re-test access code |
| Connect handoff did not open | Connect not installed / Docker | Install [Bambu Connect](https://wiki.bambulab.com/en/software/bambu-connect); in Docker download the staged file or set `BAMBU_CONNECT_HOST_PATH_MAP` |
| SaaS cannot reach printer | LAN not reachable | Desk-v1 is self-host; SaaS needs a future site-agent |

---

## Link fleet ↔ host

1. **Settings → Printer fleet** — add a machine from a preset (bed size for 3MF).
2. **Link host** → select the Moonraker / PrusaLink / Bambu row.
3. Status pill polls `GET /api/v1/integrations/:id/status` (Idle · Printing N% · Complete · Offline · Error).

Deleting a host clears `integration_id` / `device_id` on any fleet rows that pointed at it.

## Send a sliced file

1. Slice in Orca / PrusaSlicer / etc. → `.gcode` or `.bgcode`.
2. **Export → Send to printer** → pick a linked **Moonraker or PrusaLink** fleet machine (status shows Idle/Busy; picker prefers Idle) → **Upload**, **Upload & start** (blocked while busy), **Queue for idle** (this machine), or **Any matching idle** (same bed size; prefers loaded filament that matches tracked Progress parts).
3. Optional **Progress verify tracking:** when the active plan has missing Progress units, leave **Track for Progress verify when this print finishes** on and multi-select which missing parts this job covers (defaults to all missing). Incomplete unit indices are stored with the upload.
4. JobTray shows kind **Send to printer** (`printer-upload`): uploading… → complete / error.

Print Partner does **not** slice. Wrong extension → client toast. Unlinked fleet → card points to Settings. Bambu-linked only → card explains status-only and points to this doc.

## Progress live strip (Phase C)

After a fleet row is linked, open **Progress**. Above the search/filters sticky bar you’ll see a banner per linked host:

- **Idle** — host reachable, no active print
- **Printing · filename · N% · ETA …** — when the host reports a job (ETA only if the adapter returns `eta_seconds`)
- **Complete · filename** — successful finish (Phase D queues Progress verify for Moonraker/PrusaLink send mappings)
- **Offline** / **Error** — host unreachable or adapter error (link back to Settings)

The strip polls status about every 5 seconds while the tab is visible; manual −/+ checkoff still works. **Bambu-linked hosts** appear here as **status only** (no Export send / verify mapping from Bambu yet).

**Send queue (Phase F):** when Export has **Queue for idle** jobs waiting, Progress shows the same **Send queue** panel (Send ready / Send now / Remove) under the live strip so you can manage the farm without leaving Progress. Empty queue hides the panel.

## Verify-first Progress (Phase D)

1. At send time, map incomplete Progress units (see above) → durable `printer.checkoff_links` record (watching).
2. Keep **Progress** open (or reopen it) so the live strip can poll + reconcile.
3. When the host reports **`complete`** for that filename, the link becomes `awaiting_verify` (toast: verify N parts). **Units are not marked printed yet.**
4. In the **Verify print** panel: **Confirm** patches Progress; **Reject** requires a reason tag (and optional note) and leaves the unit unprinted. Outcomes are stored for failure learning.
5. Cancel / error / idle after a partial print → `host_failed` (dismissible). Refresh will not re-queue (`verified` / `dismissed` / `host_failed`).

**Note:** Verify mappings are created from Export send. Because Bambu send is not shipped, Bambu status alone does not create checkoff links.

**Debug:**

- `GET /api/v1/printer-checkoff?state=watching` — pending host watches
- `GET /api/v1/printer-checkoff?state=awaiting_verify&profile_id=` — verify queue
- `POST /api/v1/printer-checkoff/reconcile` body `{ "integration_id": "…" }` — fetches live status; may return `updates` (`awaiting_verify` / `host_failed`)
- `POST /api/v1/printer-checkoff/verify` — confirm/reject decisions
- `GET /api/v1/printer-outcomes/summary?profile_id=` — reject reason aggregates
- Job result may include `checkoff_link_id` / `checkoff_units` after upload

---

## Common failures

| Symptom | Likely cause | What to check |
|---------|--------------|---------------|
| Test: `base_url is required` | Empty URL | Paste `http://…` without path typos |
| Test: HTTP 401 | Auth | Moonraker API key; PrusaLink digest user/password |
| Test: `klippy: error` / not ready | Klipper down | Fix printer/Klippy; retry when `ready` |
| Test / status: private address blocked | SSRF (unexpected) | Self-host should use `allowPrivate: true`; cloud metadata `169.254.169.254` stays blocked |
| Status Offline | Host down, disabled, or wrong URL | Enabled checkbox; ping URL from the Print Partner machine |
| Upload: wrong file type | Not `.gcode` / `.bgcode` | Re-export from slicer |
| Upload: not linked | Fleet row has no host | Link host on Printer fleet |
| Upload: Bambu not supported | Status-only adapter | Use Moonraker/PrusaLink or wait for official Connect/Local Server path |
| Upload & start failed after upload | Host busy / bad filename | File is on host; start separately or free the printer |
| PrusaLink HTTP 409 | File exists | Adapter sends `Overwrite: ?1`; still fails → rename file |
| Verify never appears | No mapping / Progress closed / cancel | Enable checkbox + select parts at send; open Progress; confirm host shows Complete not Idle after cancel |
| Units already checked | Manual −/+ or prior apply | Toast may say units already checked off; link stays `applied` |
| SaaS cannot reach printer | LAN not reachable | Desk-v1 is self-host; SaaS needs a future site-agent |

---

## Reading JobTray and logs

**JobTray (footer):** kind label **Send to printer**, progress message (`Uploading frame_x.gcode to Shop Voron`, then success/error). Errors never include API keys.

**Server logs (Fastify):** look for `printer-upload` job start/finish and outbound fetch failures. Adapter errors surface as the job `message` / `error` string.

**API:**

- `POST /api/v1/integrations/:id/test`
- `GET /api/v1/integrations/:id/status` — includes `complete` when the host finished successfully
- `POST /jobs/printer-upload` (multipart: `file`, `printer_id`, `start=0|1`, optional `profile_id`, `checkoff_units`)
- `POST /api/v1/printer-send-queue` — multipart enqueue (same fields as send; waits for Idle by default; optional `match=compatible` for any same-bed idle host)
- `GET /api/v1/printer-send-queue?active=1` — queued / sending / error items
- `POST /api/v1/printer-send-queue/:id/dispatch` — send now (`{ "force": true }` skips Idle wait)
- `POST /api/v1/printer-send-queue/drain` — dispatch one queued job per idle printer
- `DELETE /api/v1/printer-send-queue/:id` — cancel queued/error item
- `GET /api/v1/printer-checkoff`
- `POST /api/v1/printer-checkoff/reconcile`
- `POST /api/v1/printer-checkoff/verify`
- `GET /api/v1/printer-outcomes/summary`

---

## See also

- [Printer UX](PRINTER_UX.md) — screens and phased A→F map
- [Printer API research](PRINTER_APIS.md) — Moonraker / PrusaLink / Bambu stance
- [Architecture](../ARCHITECTURE.md) — integrations and fleet presets
- [HTTP API](../API.md) — `/api/v1/integrations`, jobs
