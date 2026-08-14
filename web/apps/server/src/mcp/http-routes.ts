/**
 * Streamable HTTP MCP on the live app process (same tools as stdio).
 * Mounted under /api/v1/mcp.
 *
 * Fail-closed: PRINT_PARTNER_API_KEY is required unless HOST is loopback.
 * Pending proposes are bound to the MCP session (mcp-session-id) — one client
 * cannot list/confirm/dismiss another's.
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AssistantProposedAction } from "@print-partner/contracts";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ServerConfig } from "../config.js";
import type { AppRepository } from "../db/repository.js";
import type { InProcessJobRunner } from "../routes/jobs.js";
import { sendProblem } from "../lib/api-error.js";
import {
  createProductMcpServer,
  isLoopbackBindHost,
} from "./product-mcp.js";

type McpHttpDeps = {
  getRepo: () => AppRepository;
  jobs: InProcessJobRunner;
  config: ServerConfig;
};

type McpSession = {
  transport: StreamableHTTPServerTransport;
  server: Server;
  pending: Map<string, AssistantProposedAction>;
};

function extractApiKey(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim() || null;
  }
  const custom = request.headers["x-print-partner-api-key"];
  if (typeof custom === "string" && custom.trim()) return custom.trim();
  return null;
}

/** MCP auth: always require API key when configured; when unset, only loopback binds may expose MCP. */
export function assertMcpHttpAllowed(
  config: ServerConfig,
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const key = config.integrationApiKey;
  if (!key) {
    if (isLoopbackBindHost(config.host)) return true;
    void sendProblem(
      reply,
      503,
      "Service Unavailable",
      "PRINT_PARTNER_API_KEY is required for /api/v1/mcp when HOST is not loopback",
    );
    return false;
  }
  const provided = extractApiKey(request);
  if (!provided || provided !== key) {
    void sendProblem(reply, 401, "Unauthorized", "Valid API key required");
    return false;
  }
  return true;
}

export async function registerMcpHttpRoutes(
  app: FastifyInstance,
  deps: McpHttpDeps,
): Promise<void> {
  const planEnv = process.env.PRINT_PARTNER_MCP_PLAN_ID;
  const defaultPlanId =
    planEnv && Number.isFinite(Number(planEnv)) ? Math.trunc(Number(planEnv)) : null;

  /** Per streamable-HTTP session — not process-wide. */
  const sessions = new Map<string, McpSession>();

  const mcpAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!assertMcpHttpAllowed(deps.config, request, reply)) return reply;
  };

  app.post("/mcp", { preHandler: mcpAuth }, async (request, reply) => {
    const sessionHeader = request.headers["mcp-session-id"];
    const sessionId =
      typeof sessionHeader === "string" && sessionHeader.trim()
        ? sessionHeader.trim()
        : Array.isArray(sessionHeader) && sessionHeader[0]
          ? String(sessionHeader[0]).trim()
          : "";

    try {
      const existing = sessionId ? sessions.get(sessionId) : undefined;

      if (!existing) {
        if (sessionId || !isInitializeRequest(request.body)) {
          return reply.status(400).send({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: sessionId
                ? "Bad Request: Unknown MCP session"
                : "Bad Request: No valid session ID provided",
            },
            id: null,
          });
        }

        const pending = new Map<string, AssistantProposedAction>();
        const server = createProductMcpServer({
          getRepo: deps.getRepo,
          jobs: deps.jobs,
          config: deps.config,
          defaultPlanId,
          pending,
          tenantId: request.tenantId,
        });

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server, pending });
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) sessions.delete(sid);
        };

        reply.hijack();
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
        return;
      }

      reply.hijack();
      await existing.transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (err) {
      console.error("[mcp-http]", err);
      if (!reply.raw.headersSent) {
        try {
          reply.raw.writeHead(500, { "Content-Type": "application/json" });
          reply.raw.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null,
            }),
          );
        } catch {
          /* response already committed */
        }
      }
    }
  });

  app.get("/mcp", { preHandler: mcpAuth }, async (request, reply) => {
    const sessionHeader = request.headers["mcp-session-id"];
    const sessionId =
      typeof sessionHeader === "string" && sessionHeader.trim()
        ? sessionHeader.trim()
        : "";
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      return reply.status(405).send({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      });
    }
    reply.hijack();
    await session.transport.handleRequest(request.raw, reply.raw);
  });

  app.delete("/mcp", { preHandler: mcpAuth }, async (request, reply) => {
    const sessionHeader = request.headers["mcp-session-id"];
    const sessionId =
      typeof sessionHeader === "string" && sessionHeader.trim()
        ? sessionHeader.trim()
        : "";
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      return reply.status(404).send({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Session not found" },
        id: null,
      });
    }
    reply.hijack();
    await session.transport.handleRequest(request.raw, reply.raw);
    sessions.delete(sessionId);
  });
}
