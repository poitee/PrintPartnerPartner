# Print Partner web — self-host (API + SPA on one port)
FROM node:22-bookworm-slim AS build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
COPY web/apps/web/package.json ./apps/web/
COPY web/apps/server/package.json ./apps/server/
COPY web/packages/contracts/package.json ./packages/contracts/
COPY web/packages/domain/package.json ./packages/domain/
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app/web
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV PRINT_PARTNER_DATA_DIR=/data
ENV STATIC_DIR=/app/web/apps/web/dist
COPY --from=build /app/web ./
WORKDIR /app/web/apps/server
EXPOSE 8080
CMD ["node", "dist/index.js"]
