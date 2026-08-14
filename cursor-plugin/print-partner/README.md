# Print Partner Cursor plugin

In-repo Cursor plugin that connects to a **running** Print Partner host over **streamable HTTP MCP**.

## Install

1. In Cursor: **Plugins** → add from this folder (`cursor-plugin/print-partner`), or copy the folder into your plugins path.
2. Configure variables:
   - `PRINT_PARTNER_MCP_URL` — e.g. `https://print-partner.example/api/v1/mcp` (HTTPS for remote; `http://127.0.0.1:8080/api/v1/mcp` only for loopback/tunnel)
   - `PRINT_PARTNER_API_KEY` — same value as host `PRINT_PARTNER_API_KEY` (required when `HOST` is not loopback)
3. Enable the `print-partner` MCP server.

Marketplace listing is optional; this manifest is enough for attach.

See [docs/assistant-mcp.md](../../docs/assistant-mcp.md) for Cursor / Grok / Claude connect cards.
