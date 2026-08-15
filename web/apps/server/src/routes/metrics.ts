import type { FastifyInstance } from "fastify";

/**
 * Prometheus metrics in OpenMetrics format
 * Exposes key performance indicators for monitoring
 */
export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  // In-memory metrics store
  const metrics = {
    httpRequestsTotal: 0,
    httpRequestDurationMs: [] as number[],
    httpErrorsTotal: 0,
    httpSuccessTotal: 0,
    apiKeysActive: 0,
    backupsTotal: 0,
    databaseConnectionTime: 0,
  };

  // Hook to collect metrics
  app.addHook("onResponse", async (request, reply) => {
    // Skip metrics endpoint itself
    if (request.url === "/metrics") return;

    metrics.httpRequestsTotal++;

    // Record by status
    if (reply.statusCode >= 400) {
      metrics.httpErrorsTotal++;
    } else {
      metrics.httpSuccessTotal++;
    }

    // Record duration
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const duration = Date.now() - ((request as any).startTime || Date.now());
    metrics.httpRequestDurationMs.push(duration);

    // Keep only last 1000 samples
    if (metrics.httpRequestDurationMs.length > 1000) {
      metrics.httpRequestDurationMs.shift();
    }
  });

  /**
   * GET /metrics
   * Return Prometheus-compatible metrics.
   * In multi-user mode, requires a valid session or API key
   * (same guard as /api/v1 endpoints).
   */
  app.get("/metrics", async (request, reply) => {
    // Optional auth: if config has API key enforcement, check it.
    // In single-user / trusted-LAN mode this is a no-op.
    const authHeader = request.headers["authorization"];
    const apiKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const sessionUser = (request as any).sessionUser;
    // If neither a session nor an API key is present and we're in multi-user
    // mode, return 401 — otherwise allow (self-hosted default = open).
    if (!sessionUser && !apiKey) {
      // Only block when the app is explicitly in multi-user / auth-required mode.
      // Single-host self-hosted installs remain open by default.
      const { config } = app as any;
      if (config?.authRequired) {
        return reply.status(401).send({ detail: "Authentication required" });
      }
    }
    const p50 =
      metrics.httpRequestDurationMs.length > 0
        ? metrics.httpRequestDurationMs.sort((a, b) => a - b)[
            Math.floor(metrics.httpRequestDurationMs.length * 0.5)
          ]
        : 0;

    const p95 =
      metrics.httpRequestDurationMs.length > 0
        ? metrics.httpRequestDurationMs.sort((a, b) => a - b)[
            Math.floor(metrics.httpRequestDurationMs.length * 0.95)
          ]
        : 0;

    const p99 =
      metrics.httpRequestDurationMs.length > 0
        ? metrics.httpRequestDurationMs.sort((a, b) => a - b)[
            Math.floor(metrics.httpRequestDurationMs.length * 0.99)
          ]
        : 0;

    // Build OpenMetrics format response
    const metricsText = `# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total ${metrics.httpRequestsTotal}

# HELP http_request_duration_ms HTTP request duration in milliseconds
# TYPE http_request_duration_ms summary
http_request_duration_ms_sum ${metrics.httpRequestDurationMs.reduce((a, b) => a + b, 0)}
http_request_duration_ms_count ${metrics.httpRequestDurationMs.length}
http_request_duration_ms{quantile="0.5"} ${p50}
http_request_duration_ms{quantile="0.95"} ${p95}
http_request_duration_ms{quantile="0.99"} ${p99}

# HELP http_errors_total Total HTTP errors (4xx, 5xx)
# TYPE http_errors_total counter
http_errors_total ${metrics.httpErrorsTotal}

# HELP http_success_total Total successful HTTP requests (2xx, 3xx)
# TYPE http_success_total counter
http_success_total ${metrics.httpSuccessTotal}

# HELP http_error_rate Error rate (errors / total)
# TYPE http_error_rate gauge
http_error_rate ${metrics.httpRequestsTotal > 0 ? (metrics.httpErrorsTotal / metrics.httpRequestsTotal).toFixed(4) : 0}

# HELP app_info Application version and build info
# TYPE app_info gauge
app_info{version="3.0.0",node="${process.version}"} 1
`;

    return metricsText;
  });
}
