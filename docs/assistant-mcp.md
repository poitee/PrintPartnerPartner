# Print Partner MCP (attach)

Print Partner is the **kit brain**. Attach Cursor, Grok, or Claude to the **existing product tools** over MCP. There is no in-app kit advisor chat.

Mutations stay **confirm-to-apply** (`confirm_apply` / `dismiss_proposed_action`). Never auto-compose, auto-tick, or start a print.

## Prefer HTTP on the live host

On a running self-host / Docker app:

| | |
|--|--|
| URL | `http://<host>:<port>/api/v1/mcp` |
| Auth | `Authorization: Bearer <PRINT_PARTNER_API_KEY>` or `X-Print-Partner-Api-Key` |
| Transport | Streamable HTTP (same tools as stdio) |

Set `PRINT_PARTNER_API_KEY` on the server (same key as REST `/api/v1/*`).

**Do not** point stdio MCP at the live Docker `PRINT_PARTNER_DATA_DIR` while the app is running — that is a second SQLite writer.

## Cursor

### Plugin (recommended)

Install the in-repo plugin at [`cursor-plugin/print-partner`](../cursor-plugin/print-partner). Set:

- `PRINT_PARTNER_MCP_URL` = `http://192.168.200.80:8080/api/v1/mcp` (your host)
- `PRINT_PARTNER_API_KEY` = your API key

### Manual `mcp.json`

```json
{
  "mcpServers": {
    "print-partner": {
      "url": "http://192.168.200.80:8080/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

## Grok

Use the same **URL + API key** connect card as Cursor (streamable HTTP MCP). Point the bot at `/api/v1/mcp` with Bearer auth.

## Claude Desktop

Prefer **HTTP** when the host exposes `/api/v1/mcp`.

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
| `list_pending_actions` / `confirm_apply` / `dismiss_proposed_action` | Confirm-to-apply |

SPA-only `ui_*` tools are not registered. There is no `start_print` tool.

## Out of scope

- In-app Ask assistant / Kit Advisor sheet / Settings → AI
- Model fine-tuning / training
- Autonomous open-web crawlers (URL ingest remains explicit `ingest_guide_url` / `ingest_guide_text`)
