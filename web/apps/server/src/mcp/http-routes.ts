/**
 * Streamable HTTP MCP on the live app process (same tools as stdio).
 * Mounted under /api/v1/mcp — gated by PRINT_PARTNER_API_KEY when set.
 */

import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ServerConfig } from "../config.js";
import type { AppRepository } from "../db/repository.js";
import type { InProcessJobRunner } from "../routes/jobs.js";
import { createProductMcpServer, httpMcpPending } from "./product-mcp.js";

type McpHttpDeps = {
  getRepo: () => AppRepository;
  jobs: InProcessJobRunner;
  config: ServerConfig;
};

export async function registerMcpHttpRoutes(
  app: FastifyInstance,
  deps: McpHttpDeps,
): Promise<void> {
  const planEnv = process.env.PRINT_PARTNER_MCP_PLAN_ID;
  const defaultPlanId =
    planEnv && Number.isFinite(Number(planEnv)) ? Math.trunc(Number(planEnv)) : null;

  const handleMcp = async (
    request: { raw: import("node:http").IncomingMessage; body: unknown; method: string },
    reply: {
      raw: import("node:http").ServerResponse;
      hijack: () => void;
      status: (code: number) => { send: (body: unknown) => unknown };
    },
  ) => {
    if (request.method === "GET" || request.method === "DELETE") {
      return reply.status(405).send({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      });
    }

    reply.hijack();
    const server = createProductMcpServer({
      getRepo: deps.getRepo,
      jobs: deps.jobs,
      config: deps.config,
      defaultPlanId,
      pending: httpMcpPending,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (err) {
      console.error("[mcp-http]", err);
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "Content-Type": "application/json" });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }),
        );
      }
    } finally {
      reply.raw.on("close", () => {
        void transport.close();
        void server.close();
      });
    }
  };

  app.post("/mcp", async (request, reply) => {
    await handleMcp(request, reply);
  });
  app.get("/mcp", async (_request, reply) => {
    return reply.status(405).send({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });
  app.delete("/mcp", async (_request, reply) => {
    return reply.status(405).send({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });
}
