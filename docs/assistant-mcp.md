# Kit advisor MCP server

Thin **stdio** MCP bridge over Print Partner assistant product verbs. Same implementations as the in-app kit advisor; mutations stay confirm-to-apply.

## Run

```bash
cd web
export PRINT_PARTNER_DATA_DIR=./data   # optional
export PRINT_PARTNER_MCP_PLAN_ID=1     # optional default plan
npm run mcp -w @print-partner/server
```

Full Cursor / Claude Desktop config: [web/DEPLOY.md](../web/DEPLOY.md) (Kit advisor MCP).

## Semantics

| Kind | Behavior |
|------|----------|
| Read tools | Run immediately (`get_kit_catalog`, `ingest_guide_url`, …) |
| Mutate tools | Propose only; response includes an action `id` |
| `list_pending_actions` | Pending proposes in this MCP process |
| `confirm_apply` | Applies by `action_id`; optional `suggested_excludes` override |
| `dismiss_proposed_action` | Drop a pending propose |

SPA-only `ui_*` tools are not registered.

## Out of scope

- Model fine-tuning / training
- Autonomous open-web crawlers (URL ingest remains explicit `ingest_guide_url` / `ingest_guide_text`)
