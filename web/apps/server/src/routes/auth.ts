import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ServerConfig } from "../config.js";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type SessionUser = {
  tenant_id: string;
  login: string;
  provider: "github" | "basic" | "anonymous";
};

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string;
    sessionUser: SessionUser | null;
  }
}

const sessions = new Map<string, SessionUser>();

function sessionSecret(config: ServerConfig): string {
  return config.sessionSecret ?? "dev-insecure-change-me";
}

export function createSessionToken(user: SessionUser, config: ServerConfig): string {
  const payload = Buffer.from(JSON.stringify(user)).toString("base64url");
  const sig = createHmac("sha256", sessionSecret(config)).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function parseSessionToken(token: string, config: ServerConfig): SessionUser | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", sessionSecret(config)).update(payload).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionUser;
  } catch {
    return null;
  }
}

export function registerAuthRoutes(app: FastifyInstance, config: ServerConfig): void {
  app.get("/auth/me", async (request, reply) => {
    if (!request.sessionUser) {
      return reply.status(401).send({ detail: "Not authenticated" });
    }
    return { user: request.sessionUser };
  });

  app.post("/auth/logout", async (request, reply) => {
    const cookie = request.cookies?.pp_session;
    if (cookie) sessions.delete(cookie);
    reply.clearCookie("pp_session", { path: "/" });
    return { ok: true };
  });

  if (config.githubOAuthConfigured) {
    app.get("/auth/github", async (_request, reply) => {
      const state = randomBytes(16).toString("hex");
      const params = new URLSearchParams({
        client_id: config.githubClientId!,
        redirect_uri: config.githubCallbackUrl!,
        scope: "read:user",
        state,
      });
      reply.setCookie("oauth_state", state, { httpOnly: true, path: "/", maxAge: 600 });
      return reply.redirect(`https://github.com/login/oauth/authorize?${params}`);
    });

    app.get("/auth/callback", async (request, reply) => {
      const query = request.query as { code?: string; state?: string };
      const stateCookie = request.cookies?.oauth_state;
      if (!query.code || !query.state || query.state !== stateCookie) {
        return reply.status(400).send({ detail: "Invalid OAuth state" });
      }
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: config.githubClientId,
          client_secret: config.githubClientSecret,
          code: query.code,
          redirect_uri: config.githubCallbackUrl,
        }),
      });
      const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
      if (!tokenJson.access_token) {
        return reply.status(401).send({ detail: tokenJson.error ?? "OAuth failed" });
      }
      const userRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: "application/json" },
      });
      const ghUser = (await userRes.json()) as { login?: string; id?: number };
      const login = ghUser.login ?? "github-user";
      const tenantId = `gh-${ghUser.id ?? login}`;
      const user: SessionUser = { tenant_id: tenantId, login, provider: "github" };
      const sid = randomBytes(24).toString("hex");
      sessions.set(sid, user);
      reply.setCookie("pp_session", sid, { httpOnly: true, path: "/", maxAge: 60 * 60 * 24 * 14 });
      reply.clearCookie("oauth_state", { path: "/" });
      return reply.redirect(config.authSuccessRedirect);
    });
  } else {
    app.get("/auth/github", async (_request, reply) => {
      return reply.status(501).send({
        detail: "GitHub OAuth not configured. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_CALLBACK_URL.",
      });
    });
    app.get("/auth/callback", async (_request, reply) => {
      return reply.status(501).send({ detail: "GitHub OAuth not configured" });
    });
  }

  app.post("/auth/dev-login", async (request, reply) => {
    if (config.deployMode !== "saas") {
      return reply.status(404).send({ detail: "Not available" });
    }
    const body = request.body as { tenant_id?: string; login?: string };
    const user: SessionUser = {
      tenant_id: body.tenant_id ?? "saas-dev",
      login: body.login ?? "dev",
      provider: "anonymous",
    };
    const sid = randomBytes(24).toString("hex");
    sessions.set(sid, user);
    reply.setCookie("pp_session", sid, { httpOnly: true, path: "/", maxAge: 60 * 60 * 24 * 7 });
    return { user };
  });
}

export function resolveRequestAuth(
  request: FastifyRequest,
  config: ServerConfig,
): SessionUser | null {
  if (config.deployMode !== "saas") {
    return { tenant_id: "default", login: "local", provider: "anonymous" };
  }

  const basic = config.saasBasicAuth;
  if (basic) {
    const header = request.headers.authorization ?? "";
    const expected = `Basic ${Buffer.from(basic).toString("base64")}`;
    if (header === expected) {
      const [login] = basic.split(":");
      return { tenant_id: `basic-${login}`, login: login ?? "basic", provider: "basic" };
    }
  }

  const sid = request.cookies?.pp_session;
  if (sid && sessions.has(sid)) return sessions.get(sid)!;

  const bearer = request.headers.authorization;
  if (typeof bearer === "string" && bearer.startsWith("Bearer ")) {
    const user = parseSessionToken(bearer.slice(7), config);
    if (user) return user;
  }

  if (config.saasAllowAnonymous) {
    return { tenant_id: "anonymous", login: "anonymous", provider: "anonymous" };
  }

  return null;
}

export function registerTenantMiddleware(app: FastifyInstance, config: ServerConfig): void {
  app.decorateRequest("tenantId", "default");
  app.decorateRequest("sessionUser", null);

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (path === "/health" || path.startsWith("/auth/")) return;

    if (config.deployMode === "self-host" && config.basicAuthUser && config.basicAuthPass) {
      const header = request.headers.authorization ?? "";
      const expected = `Basic ${Buffer.from(`${config.basicAuthUser}:${config.basicAuthPass}`).toString("base64")}`;
      if (header !== expected) {
        reply.header("WWW-Authenticate", 'Basic realm="Print Partner"');
        return reply.status(401).send({ detail: "Authentication required" });
      }
    }

    const user = resolveRequestAuth(request, config);
    if (!user && config.deployMode === "saas" && config.authRequired) {
      reply.header("WWW-Authenticate", 'Basic realm="Print Partner"');
      return reply.status(401).send({ detail: "Authentication required" });
    }

    request.sessionUser = user;
    request.tenantId = user?.tenant_id ?? "default";
  });
}
