# Print Partner Cursor plugin

In-repo Cursor plugin that connects to a **running** Print Partner host over **streamable HTTP MCP**.

## Install

1. In Cursor: **Plugins** → add from this folder (`cursor-plugin/print-partner`), or copy the folder into your plugins path.
2. Configure variables:
   - `PRINT_PARTNER_MCP_URL` — e.g. `http://192.168.200.80:8080/api/v1/mcp`
   - `PRINT_PARTNER_API_KEY` — same value as host `PRINT_PARTNER_API_KEY`
3. Enable the `print-partner` MCP server.

Marketplace listing is optional; this manifest is enough for attach.

See [docs/assistant-mcp.md](../../docs/assistant-mcp.md) for Cursor / Grok / Claude connect cards.
