# Print Partner Architecture

A comprehensive guide to Print Partner's design, systems, and operational considerations.

## Overview

Print Partner is a self-hosted print job management platform built with:
- **Frontend**: React + TypeScript SPA (Vite)
- **Backend**: Fastify + TypeScript API server
- **Database**: SQLite (default) or PostgreSQL (SaaS)
- **Deployment**: Docker/Docker Compose with non-root execution

## System Architecture

### Directory Structure

```
PrintPartnerPartner/
├── web/                           # Monorepo root
│   ├── apps/
│   │   ├── server/               # Backend API (Fastify)
│   │   │   ├── src/
│   │   │   │   ├── routes/       # HTTP route handlers
│   │   │   │   ├── services/     # Business logic
│   │   │   │   ├── middleware/   # Request processing
│   │   │   │   ├── lib/          # Shared utilities
│   │   │   │   ├── db/           # Database layer
│   │   │   │   ├── integrations/ # External service adapters
│   │   │   │   └── assistant/    # AI assistant logic
│   │   │   └── dist/             # Compiled output (build artifact)
│   │   └── web/                  # Frontend SPA (React)
│   │       ├── src/
│   │       └── dist/             # Built SPA (build artifact)
│   └── packages/
│       ├── contracts/            # Shared TypeScript types
│       └── domain/               # Domain-specific utilities
├── Dockerfile                     # Multi-stage build, non-root user
├── docker-compose.yml            # Self-host deployment
└── scripts/release.sh            # Version management and tagging
```

### Core Services

#### API Server (`web/apps/server`)

The backend runs on Node.js + Fastify with the following responsibilities:

- **Route Handling** (`routes/`): HTTP endpoints for API v1, webhooks, backups, logging, API-key management
- **Business Logic** (`services/`): Job management, plan execution, integrations
- **Database** (`db/`): SQLite/PostgreSQL abstraction layer
- **Middleware** (`middleware/`): Request logging, API key authentication, tenant isolation
- **Integrations** (`integrations/`): Printer adapters (Bambu, Moonraker, PrusaLink, Spoolman)
- **Assistant** (`assistant/`): AI-powered print guidance and analysis

**Key Features:**
- Modular service architecture
- Type-safe database queries
- Comprehensive error handling
- Security hardening (SSRF guards, API key rotation, webhook validation)

#### Frontend SPA (`web/apps/web`)

React-based single-page application providing:
- Print planning and design import
- Job submission and monitoring
- Live print preview
- Integration configuration
- Settings and API-key management

## Security Model

### SSRF Protection

All outbound HTTP requests (webhooks, external integrations) are validated against blocked address ranges:
- **Always blocked**: Cloud metadata endpoints (169.254.169.254, fd00:ec2::254)
- **Blocked by default**: Private IPs (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, loopback)
- **Allowed with flag**: LAN integrations (Bambu, Moonraker, etc. with `allowPrivate: true`)

Implementation: `lib/outbound-url.ts`

### Webhook Security

Webhooks are protected by:
1. **SSRF Validation**: URL validated before storage and on every dispatch
2. **HMAC-SHA256 Signatures**: Events signed with secret key (not sent in plaintext)
3. **Redirect Validation**: Each HTTP redirect hop is validated
4. **Timeout Protection**: 10-second timeout per delivery attempt
5. **Error Logging**: Failures captured in workflow logger for debugging

Implementation: `services/webhook-store.ts`

### API Key Management

API keys use:
- **Generation**: Cryptographically random 32-byte keys (ppk_* format)
- **Storage**: Base64-encoded hashes (not plaintext)
- **Rotation**: Create new key, mark old as inactive (no deletion needed)
- **Tracking**: Last-used timestamp for auditing
- **Endpoints**: Full CRUD via `/settings/api-keys`

Implementation: `services/api-key-manager.ts`

### Container Security

The Docker image runs as:
- **Non-root user**: `ppuser` (uid 1000, gid 1000)
- **Signal handling**: dumb-init for proper PID 1 management
- **Minimized attack surface**: Dev dependencies removed in final image
- **File permissions**: Explicit ownership and restricted access

Implementation: `Dockerfile`

## Observability

### Workflow Logging

The logging system captures detailed workflow traces for every request:

**Features:**
- **Configurable severity**: debug, info, warn, error
- **Persistent storage**: 10,000 in-memory logs (FIFO)
- **Auto-tracking**: HTTP middleware captures method, URL, duration, status, params
- **Context capture**: Request metadata, user ID, webhook details
- **Export**: JSON/JSONL format for agent analysis
- **Filtering**: Query by severity, method, limit

**Endpoints:**
- `GET /settings/logging/config` — Current configuration
- `POST /settings/logging/config` — Update settings
- `GET /settings/logging/logs` — Filtered logs
- `GET /settings/logging/stats` — Summary statistics
- `POST /settings/logging/export` — Download as JSON/JSONL
- `DELETE /settings/logging/logs` — Clear logs

**Noise Reduction:**
- Health checks (30s intervals) are skipped
- Static file accesses are skipped
- Polling endpoints (printer-send-queue, filaments) are skipped
- Only meaningful operations are logged

Implementation: `services/logger.ts`, `middleware/request-logging.ts`

### Health Endpoint

`GET /health` returns comprehensive system status:

```json
{
  "ok": true,
  "version": "3.0.0",
  "semver": "v3.0.0+abc1234",
  "build": {
    "version": "3.0.0",
    "commit": "abc1234",
    "branch": "main",
    "tag": "v3.0.0",
    "buildDate": "2026-08-15T18:20:00.000Z",
    "nodeVersion": "v22.23.2"
  },
  "capabilities": [
    "kit_planning",
    "jobs_ws",
    "backups",
    "logging",
    "api_key_management",
    "webhook_security"
  ],
  "db": {
    "connected": true,
    "driver": "sqlite",
    "postgres": null
  }
}
```

## Backup & Restore

### System Design

Backups capture:
- SQLite database (primary.db)
- WAL and SHM files (for consistency)
- Compressed as gzip tarball
- Versioned with ISO timestamps

**Endpoints:**
- `POST /backups` — Create backup (returns metadata)
- `GET /backups` — List all backups with sizes
- `GET /backups/:name` — Download backup file
- `POST /backups/validate` — Check backup integrity
- `POST /backups/restore` — Restore with automatic pre-restore backup
- `DELETE /backups/:name` — Remove backup

### Safety

1. **Automatic backup before restore**: If restore fails, prior state is preserved
2. **Validation**: Checksum verification on download
3. **Timeout protection**: 120-second max per operation
4. **Error logging**: All operations tracked in workflow logger

Implementation: `services/backup-restore.ts`, `routes/backups.ts`

## Deployment

### Docker Compose (Self-Host)

```bash
docker compose up -d
# Available at http://localhost:8080
```

Features:
- Single command startup
- Data persisted to named volume
- Health checks every 30 seconds
- Non-root execution
- No authentication required on trusted LAN

### Version Management

Release workflow:
```bash
./scripts/release.sh patch|minor|major
# Creates git tag with changelog
# Updates version in package.json
# Tags pushed separately
```

The health endpoint exposes version info for monitoring and CI/CD pipelines.

## Development Workflow

### Building

```bash
cd web
npm run build
npm test
```

### Running Locally

```bash
npm run dev
# Starts dev server with hot reload
# API: http://localhost:5173 (proxied to backend)
```

### Testing

```bash
npm test              # Run all tests
npm test -- --watch  # Watch mode
npm test -- integration  # Run specific suite
```

All tests must pass before commits to main.

## Integration Patterns

### Printer Adapters

Print Partner supports multiple printer types via adapter pattern:

- **Bambu Lab**: MQTT over TLS (private IP)
- **Moonraker**: HTTP API (Klipper-based)
- **PrusaLink**: HTTP API (Prusa printers)
- **Spoolman**: HTTP API (filament inventory)

Each adapter:
1. Validates URL via SSRF guard
2. Implements retry logic with exponential backoff
3. Logs operations to workflow logger
4. Handles authentication securely

### Webhook Events

Webhooks dispatch on:
- `job.done` — Print completed successfully
- `job.error` — Print failed or cancelled

Payload structure:
```json
{
  "event": "job.done",
  "jobId": "...",
  "planId": "...",
  "printerId": "...",
  "duration": 3600000,
  "timestamp": "2026-08-15T18:20:00Z"
}
```

Signature header: `X-Print-Partner-Signature: sha256=...`

## Operational Concerns

### Database

- **SQLite** (default): Single-file database, good for small to medium deployments
- **PostgreSQL** (SaaS): Multi-user, better concurrency
- **Migrations**: Embedded in application startup
- **Backups**: Full backup/restore via REST API

### Performance

- **Caching**: Version info cached on app startup
- **Connection pooling**: Database connections reused
- **Minimal logging**: Polling endpoints excluded from logs
- **Static file serving**: Served directly (no middleware)

### Monitoring

Use the workflow logger to:
- Track API usage patterns
- Identify integration failures
- Monitor webhook delivery
- Audit API key usage

Export logs for external analysis:
```bash
curl http://localhost:8080/settings/logging/export?format=jsonl > logs.jsonl
```

## Future Improvements

1. **Distributed deployment**: Multi-instance coordination
2. **Advanced scheduling**: Batching and queue optimization
3. **ML-based predictions**: Better time estimates and auto-scheduling
4. **Mobile app**: Native iOS/Android apps
5. **Enhanced integrations**: More printer types, filament tracking, environmental sensors

## Contributing

When adding features:

1. **Follow module structure**: Place code in appropriate service/route
2. **Add tests**: Maintain 100% test coverage on new code
3. **Update logging**: Log important operations via workflow logger
4. **Security review**: Run SSRF/auth/injection checks
5. **Update health endpoint**: Add capabilities if adding features
6. **Document changes**: Update ARCHITECTURE.md if structure changes

## Troubleshooting

### Container Won't Start

Check logs: `docker compose logs print-partner`

Common issues:
- Missing `/data` directory (created automatically on first run)
- Port 8080 in use (check `docker ps`)
- Database corruption (restore from backup)

### High Memory Usage

Check workflow logger: `GET /settings/logging/stats`

If logs overflow (10,000 max):
- Reduce log level: `POST /settings/logging/config` with `minSeverity=warn`
- Export and clear: `POST /settings/logging/export` then `DELETE /settings/logging/logs`

### Slow Printer Operations

Enable debug logging:
```bash
curl -X POST http://localhost:8080/settings/logging/config \
  -H 'Content-Type: application/json' \
  -d '{"minSeverity":"debug"}'
```

Then check logs via:
```bash
curl http://localhost:8080/settings/logging/logs?severity=debug
```

---

Last updated: August 15, 2026  
Version: 3.0.0+main
