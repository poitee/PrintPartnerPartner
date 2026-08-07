/**
 * Thin stdio MCP server exposing Print Partner assistant product verbs.
 *
 * Reuses ASSISTANT_TOOL_SPECS / invokeAssistantTool / applyAssistantAction.
 * Mutating tools only propose; call confirm_apply (or dismiss_proposed_action)
 * for the same confirm-to-apply semantics as the SPA Apply cards.
 *
 * Run (from web/): npm run mcp -w @print-partner/server
 * See web/DEPLOY.md § Kit advisor MCP.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AssistantProposedAction } from "@print-partner/contracts";
import { isAssistantUiAction } from "@print-partner/contracts";
import { loadConfig } from "../config.js";
import { createPorts } from "../app.js";
import { createAssistantPort } from "../assistant/create-assistant.js";
import { resolveAssistantRuntime } from "../assistant/resolve-assistant.js";
import {
  ASSISTANT_TOOL_SPECS,
  applyAssistantAction,
  invokeAssistantTool,
  type ToolContext,
} from "../assistant/tools.js";
import { createJobRunner, type InProcessJobRunner } from "../routes/jobs.js";
import type { AppRepository } from "../db/repository.js";

const META_TOOLS = [
  {
    name: "list_pending_actions",
    description:
      "List proposed mutations waiting for confirm_apply (same as SPA Apply cards).",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "confirm_apply",
    description:
      "Apply a previously proposed action after user confirmation. Optional suggested_excludes overrides the card params (same merge as SPA).",
    inputSchema: {
      type: "object" as const,
      properties: {
        action_id: { type: "string", description: "Id from a prior propose tool result" },
        suggested_excludes: {
          type: "array",
          items: { type: "string" },
          description: "Optional override of kit-manifest exclude tags to merge on Apply",
        },
      },
      required: ["action_id"],
    },
  },
  {
    name: "dismiss_proposed_action",
    description: "Discard a pending proposed action without applying it.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action_id: { type: "string" },
      },
      required: ["action_id"],
    },
  },
] as const;

/** Product verbs exposed over MCP (skip SPA-only ui_* tools). */
function productToolSpecs() {
  return ASSISTANT_TOOL_SPECS.filter((t) => !t.name.startsWith("ui_"));
}

function jsonSchemaToMcp(spec: (typeof ASSISTANT_TOOL_SPECS)[number]) {
  return {
    name: spec.name,
    description:
      spec.tier === "mutate"
        ? `${spec.description} (proposes only — call confirm_apply to mutate)`
        : spec.description,
    inputSchema: {
      type: "object" as const,
      properties: spec.input_schema.properties ?? {},
      ...(spec.input_schema.required?.length
        ? { required: spec.input_schema.required }
        : {}),
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.deployMode !== "self-host") {
    console.error(
      "Print Partner MCP currently targets self-host (SQLite). Set DEPLOY_MODE=self-host.",
    );
    process.exit(1);
  }

  const ports = createPorts(config);
  await ports.db.connect();

  const getRepo = (): AppRepository => {
    if (ports.repository) return ports.repository;
    if (ports.getRepository) return ports.getRepository("default");
    throw new Error("No repository available");
  };

  const jobs: InProcessJobRunner = createJobRunner(getRepo, config.dataDir);
  const pending = new Map<string, AssistantProposedAction>();

  const planEnv = process.env.PRINT_PARTNER_MCP_PLAN_ID;
  const defaultPlanId =
    planEnv && Number.isFinite(Number(planEnv)) ? Math.trunc(Number(planEnv)) : null;

  function toolCtx(): ToolContext {
    const repo = getRepo();
    const runtime = resolveAssistantRuntime(repo, config);
    return {
      repo,
      activePlanId: defaultPlanId,
      useOtherBuildsAsExamples: runtime.useOtherBuildsAsExamples,
      dataDir: config.dataDir,
      assistant: createAssistantPort(runtime),
      runtime,
    };
  }

  const server = new Server(
    { name: "print-partner-assistant", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...productToolSpecs().map(jsonSchemaToMcp),
      ...META_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args =
      request.params.arguments && typeof request.params.arguments === "object"
        ? (request.params.arguments as Record<string, unknown>)
        : {};

    try {
      if (name === "list_pending_actions") {
        const actions = [...pending.values()].map((a) => ({
          id: a.id,
          type: a.type,
          plan_id: a.plan_id,
          label: a.label,
          summary: a.summary,
          params: a.params,
        }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ actions }, null, 2) }],
        };
      }

      if (name === "dismiss_proposed_action") {
        const id = String(args.action_id ?? "");
        const existed = pending.delete(id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: existed, action_id: id }),
            },
          ],
        };
      }

      if (name === "confirm_apply") {
        const id = String(args.action_id ?? "");
        const action = pending.get(id);
        if (!action) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ok: false,
                  error: "Unknown or already applied/dismissed action_id",
                  action_id: id,
                }),
              },
            ],
            isError: true,
          };
        }
        if (isAssistantUiAction(action.type)) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ok: false, error: "UI actions cannot be applied via MCP" }),
              },
            ],
            isError: true,
          };
        }
        const toApply: AssistantProposedAction =
          Array.isArray(args.suggested_excludes)
            ? {
                ...action,
                params: {
                  ...action.params,
                  suggested_excludes: args.suggested_excludes.map((x) => String(x).trim()).filter(Boolean),
                },
              }
            : action;
        const result = await applyAssistantAction(toApply, {
          repo: getRepo(),
          jobs,
        });
        if (result.ok) pending.delete(id);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          ...(result.ok ? {} : { isError: true }),
        };
      }

      const known = productToolSpecs().some((t) => t.name === name);
      if (!known) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true,
        };
      }

      const result = await invokeAssistantTool(name, args, toolCtx());
      if (result.proposedAction && !isAssistantUiAction(result.proposedAction.type)) {
        pending.set(result.proposedAction.id, result.proposedAction);
      }
      return {
        content: [{ type: "text" as const, text: result.content }],
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `print-partner-assistant MCP on stdio (data=${config.dataDir}` +
      `${defaultPlanId != null ? `, plan=${defaultPlanId}` : ""})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
