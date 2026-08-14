# Kit brain + MCP attach

Print Partner keeps the desk loop (**Plan / Parts / Progress / Export**) and exposes product tools over **MCP**. Attach **Cursor**, **Grok**, or **Claude** — there is **no in-app kit advisor chat** and **no Settings → AI**.

## Connect

Full guide: [`assistant-mcp.md`](assistant-mcp.md).

- **Live host:** streamable HTTP at `/api/v1/mcp` + `PRINT_PARTNER_API_KEY`
- **Cursor plugin:** [`cursor-plugin/print-partner`](../cursor-plugin/print-partner)
- **Stdio:** only against a `DATA_DIR` **copy** (or stop the app) — never two writers on the live Docker volume

## Confirm-to-apply

Mutating tools only **propose**. Apply with `confirm_apply` (or dismiss). Decision history stays in `plan_decisions` / `assistant_feedback` as data — not an in-app model.

## Never

- Auto-compose
- Auto-tick Progress
- `start_print` / send print from MCP

## Settings

Settings is four sections: **Printers / Library / Appearance / Account**. AI keys, providers, Ollama, budgets, and research live in your external agent — not in Print Partner Settings.
