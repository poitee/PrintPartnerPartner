# Print Partner web — self-host (API + SPA on one port)
# Multi-stage build with security hardening

FROM node:26-bookworm-slim AS build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
COPY web/apps/web/package.json ./apps/web/
COPY web/apps/server/package.json ./apps/server/
COPY web/packages/contracts/package.json ./packages/contracts/
COPY web/packages/domain/package.json ./packages/domain/
RUN npm ci
COPY web/ ./
RUN npm run build && \
    # Remove dev dependencies to reduce final image size
    npm ci --omit=dev

FROM node:26-bookworm-slim AS runtime
# Baked in by the release workflow (vX.Y.Z tag -> X.Y.Z-web); reported by GET /health.
ARG PP_VERSION=3.1.0-web

# dumb-init: proper PID 1 signal handling. gosu: drop root after entrypoint chown.
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init gosu && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user for application (uid 1000, gid 1000).
# node:bookworm-slim already has uid/gid 1000 as "node" — reclaim for ppuser.
RUN if ! id ppuser >/dev/null 2>&1; then \
      if id node >/dev/null 2>&1; then \
        groupmod -n ppuser node && \
        usermod -l ppuser -d /home/ppuser -m -s /sbin/nologin -c "Print Partner user" node; \
      else \
        groupadd -g 1000 ppuser && \
        useradd -u 1000 -g ppuser -d /home/ppuser -s /sbin/nologin -c "Print Partner user" ppuser; \
      fi; \
    fi && \
    mkdir -p /home/ppuser && \
    chown -R ppuser:ppuser /home/ppuser

WORKDIR /app/web
ENV NODE_ENV=production
ENV PP_VERSION=${PP_VERSION}
ENV HOST=0.0.0.0
ENV PORT=8080
ENV PRINT_PARTNER_DATA_DIR=/data
ENV STATIC_DIR=/app/web/apps/web/dist

# Copy built application with correct ownership
COPY --from=build --chown=ppuser:ppuser /app/web ./

WORKDIR /app/web/apps/server

# Image-layer /data ownership (named volume mounts hide this; entrypoint fixes at runtime)
RUN mkdir -p /data && chown -R ppuser:ppuser /data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

# Starts as root so entrypoint can chown named-volume /data, then drops to ppuser.
# Do not set USER here — compose must not force user: "1000:1000" either.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
