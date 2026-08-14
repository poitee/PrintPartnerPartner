# Print Partner MCP (attach)

Print Partner is the **kit brain**. Attach Cursor, Grok, or Claude to the **existing product tools** over MCP. There is no in-app kit advisor chat.

Mutations stay **confirm-to-apply** (`confirm_apply` / `dismiss_proposed_action`). Never auto-compose, auto-tick, or start a print.

## Prefer HTTP on the live host

On a running self-host / Docker app:

| | |
|--|--|
| URL (remote) | `https://<host>/api/v1/mcp` |
| URL (loopback / tunnel only) | `http://127.0.0.1:<port>/api/v1/mcp` |
| Auth | `Authorization: Bearer <PRINT_PARTNER_API_KEY>` or `X-Print-Partner-Api-Key` |
| Transport | Streamable HTTP (same tools as stdio); pending proposes are **per MCP session** |

**Fail-closed:** set `PRINT_PARTNER_API_KEY` whenever `HOST` is not loopback (Docker defaults to `0.0.0.0`). Without a key on an exposed bind, `/api/v1/mcp` returns **503**. Remote examples use **HTTPS** (terminate TLS at a reverse proxy). Plain `http://` is only for loopback or an authenticated tunnel.

**Do not** point stdio MCP at the live Docker `PRINT_PARTNER_DATA_DIR` while the app is running — that is a second SQLite writer.

## Cursor

### Plugin (recommended)

Install the in-repo plugin at [`cursor-plugin/print-partner`](../cursor-plugin/print-partner). Set:

- `PRINT_PARTNER_MCP_URL` = `https://print-partner.example/api/v1/mcp` (your HTTPS host)
- `PRINT_PARTNER_API_KEY` = your API key

### Manual `mcp.json`

```json
{
  "mcpServers": {
    "print-partner": {
      "url": "https://print-partner.example/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Loopback / local tunnel only:

```json
{
  "mcpServers": {
    "print-partner": {
      "url": "http://127.0.0.1:8080/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

## Grok

Use the same **URL + API key** connect card as Cursor (streamable HTTP MCP). Prefer **HTTPS** for remote hosts.

## Claude Desktop

Prefer **HTTPS** HTTP MCP when the host exposes `/api/v1/mcp`.

Stdio is only for a **copy** of `PRINT_PARTNER_DATA_DIR` (or stop the app first):

```bash
cd web
export PRINT_PARTNER_DATA_DIR=./data-copy
export PRINT_PARTNER_MCP_PLAN_ID=1   # optional
npm run mcp -w @print-partner/server
```

Claude Desktop `mcpServers` entry:

```json
{
  "mcpServers": {
    "print-partner": {
      "command": "npm",
      "args": ["run", "mcp", "-w", "@print-partner/server"],
      "cwd": "/path/to/PrintPartnerPartner/web",
      "env": {
        "PRINT_PARTNER_DATA_DIR": "/path/to/data-copy",
        "DEPLOY_MODE": "self-host"
      }
    }
  }
}
```

## Desk-loop tools

| Tool | Role |
|------|------|
| `list_sources` | Synced sources |
| `get_plan_snapshot` | Layers / kit selections |
| `get_remaining` | Printed vs remaining units; `can_archive` |
| `list_plans` / `get_plan_review` | Plan list / review summary |
| `duplicate_plan` | Propose duplicate (confirm_apply) |
| `archive_plan` | Propose archive when remaining = 0 (confirm_apply) |
| `list_pending_actions` / `confirm_apply` / `dismiss_proposed_action` | Confirm-to-apply (this session only) |

SPA-only `ui_*` tools are not registered. There is no `start_print` tool.

## Out of scope

- In-app Ask assistant / Kit Advisor sheet / Settings → AI
- Model fine-tuning / training
- Autonomous open-web crawlers (URL ingest remains explicit `ingest_guide_url` / `ingest_guide_text`)
