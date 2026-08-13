# Kit advisor (optional AI)

The **kit advisor** is an optional AI copilot for Print Partner. It helps you research kits and mods, compare sources, paste guide URLs, and walk build decisions — then proposes changes as **Apply** cards. Nothing mutates your plan until you confirm.

The rest of Print Partner works fully **without** AI. Turn the advisor on only when you want it.

## Where to configure it

Open **Settings → AI assistant**.

That card is the primary place to set:

- Provider (Anthropic, OpenAI, or Ollama)
- Model, base URL / Ollama URL, API key
- Behavior (use other builds as examples, max tokens, daily budgets, enabled)
- Web search (Auto / DuckDuckGo / Brave / Exa / Disabled + search API key when needed)
- URL research (allow product/guide fetches, max download size)
- Advanced Ollama context window (`ollama_num_ctx`)

Saved settings live on a per-tenant `ai_assistant` integration. **Settings wins over process env** for every field you set. Env vars remain the operator / SaaS platform fallback when no integration exists (or a field is left Auto / unset). Full mapping: [`web/DEPLOY.md`](../web/DEPLOY.md).

Status: `GET /assistant/status` reports `source` as `settings`, `env`, or `none`, plus search `configured` flags (no secrets).

## Option A — Bring your own Anthropic or OpenAI account

Use a cloud provider with your own API key. You pay that provider; Print Partner does not host models for you in self-host mode.

1. Create an API key at [Anthropic](https://console.anthropic.com/) or [OpenAI](https://platform.openai.com/).
2. In **Settings → AI assistant**:
   - Choose **Anthropic** or **OpenAI**.
   - Paste the API key (write-only; it will not be shown again).
   - Set the model (defaults are sensible: Claude Sonnet / `gpt-4o-mini`).
   - For OpenAI-compatible proxies, set **Base URL**.
3. Leave **Enabled** on, save, and click **Test connection**.
4. Click **Advisor** in the app header to open the kit advisor sheet.

Keys stay server-side (redacted in integration list responses).

## Option B — Run fully local with Ollama

Use [Ollama](https://ollama.com/) for a free, local model — no cloud API account required.

### Local Node (`npm run dev`)

1. Install Ollama and pull a model, e.g. `ollama pull llama3.1`.
2. Confirm `ollama list` shows the exact name you will use.
3. In Settings: provider **Ollama**, URL `http://127.0.0.1:11434`, model matching `ollama list`.
4. **Test connection**, then open **Advisor**.

### Docker Compose + Ollama on the host

The app container cannot reach `http://127.0.0.1:11434` (that is the *container’s* loopback). Do all of the following:

1. **Settings URL** (or env `OLLAMA_URL`): `http://host.docker.internal:11434` — Compose maps `host.docker.internal` via `extra_hosts`.
2. **Host Ollama must accept non-localhost clients**, e.g.:
   ```bash
   OLLAMA_HOST=0.0.0.0 ollama serve
   ```
   Confirm listen address is `*:11434` / `0.0.0.0:11434`, not only `127.0.0.1`.
3. **Firewall the port.** Ollama’s local API has **no built-in auth**. When binding to `0.0.0.0`, allow TCP **11434** only from the Compose app → host gateway path (Docker Desktop / `host.docker.internal` on macOS/Windows; bridge gateway on Linux). Do **not** publish or port-forward `11434` to your LAN or the public internet.
4. Recreate the app container after compose changes: `docker compose up -d --force-recreate`.
5. Set model to an exact name from `ollama list`, save, **Test connection**.

Chat uses Ollama’s native `/api/chat` so context size (`num_ctx`, default 16384) is honored. Override in Settings **Advanced** or env `OLLAMA_NUM_CTX`.

## What the advisor can do

- Answer questions about your **active plan** (layers, kit selections, synced sources).
- **Web search** (when a backend is configured) and **fetch / ingest** guide or product URLs (SSRF-guarded; size-capped).
- Propose mutations as **Apply / Dismiss** cards (`propose_add_source`, kit selections, sync/recompute recipes, etc.). Nothing writes until you click Apply.
- Remember confirmed / dismissed decisions and optional thumbs (ranking only — **not** model training). Clear via the sheet or API; clearing chat history does **not** erase decisions.
- Optionally use **other builds as examples** (few-shot *context* for this chat only — does **not** fine-tune the model). Toggle in Settings or per-chat in the sheet.

## Web search backends

| Choice in Settings | Notes |
|--------------------|--------|
| **Auto** | No Settings override — resolve env → provider-native → DuckDuckGo |
| **DuckDuckGo** | Free HTML fallback; can be brittle |
| **Brave** / **Exa** | Need a search API key (Settings or env) |
| **Disabled** | No `web_search` hits |

Anthropic / OpenAI “native” search may appear in status as informational; structured tool hits still come from an HTTP backend when configured.

## URL research

When **Allow URL research** is on, the advisor can fetch user-supplied HTTP(S) pages (private/loopback/metadata blocked). Guide text is treated as untrusted evidence. There is **no** autonomous crawler.

Paste a link → evidence → decision walk → **Apply** cards for selections / sources.

## Budgets and privacy notes

- Optional **daily request** and **token** budgets per tenant (UTC day). Exceeded → chat returns `429`.
- Your API keys and chat traffic go to the provider you chose (or stay on-machine with Ollama).
- “Use other builds as examples” and decision memory are **context for the current chat**, not training data sent to fine-tune a model.

## MCP (operators / Cursor)

A stdio MCP server exposes the same product verbs for hosts like Cursor. See [`web/DEPLOY.md`](../web/DEPLOY.md) (Kit advisor MCP) and [`docs/assistant-mcp.md`](assistant-mcp.md).

## Screenshots

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/dark/settings-ai.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/light/settings-ai.png">
  <img src="screenshots/light/settings-ai.png" alt="Settings — AI assistant configuration card.">
</picture>

**Settings → AI assistant**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/dark/advisor.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/light/advisor.png">
  <img src="screenshots/light/advisor.png" alt="Kit advisor chat sheet.">
</picture>

Header **Advisor** sheet
