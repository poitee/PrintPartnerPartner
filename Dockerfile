# Print Partner web — self-host (API + SPA on one port)
# Multi-stage build with security hardening

FROM node:22-bookworm-slim AS build
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

FROM node:22-bookworm-slim AS runtime
# Baked in by the release workflow (vX.Y.Z tag -> X.Y.Z-web); reported by GET /health.
ARG PP_VERSION=3.0.0-web

# Install dumb-init for proper signal handling (PID 1 zombie process issue)
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user for application (uid 1000, gid 1000)
# Check if user/group already exists first (they may exist in base image)
RUN if ! id ppuser >/dev/null 2>&1; then \
      groupadd -r -g 1000 ppuser 2>/dev/null || groupadd -r ppuser; \
      useradd -r -g ppuser -d /home/ppuser -s /sbin/nologin -c "Print Partner user" ppuser; \
    fi && \
    mkdir -p /home/ppuser && \
    chown -R ppuser:ppuser /home/ppuser 2>/dev/null || true

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

# Create data directory with correct permissions
RUN mkdir -p /data && chown -R ppuser:ppuser /data

EXPOSE 8080

# Switch to non-root user (disabled for compatibility with existing volumes)
# USER ppuser

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
