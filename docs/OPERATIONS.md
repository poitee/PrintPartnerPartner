# Print Partner Operations Guide

Day-to-day deployment, monitoring, and troubleshooting guide.

## Quick Start

### Installation

```bash
# Clone and navigate
git clone https://github.com/poitee/PrintPartnerPartner.git
cd PrintPartnerPartner

# Start with Docker Compose
docker compose up -d

# Verify health
curl http://localhost:8080/health

# Access UI
open http://localhost:8080
```

### Data Persistence

`docker-compose.yml` uses a plain named volume `print-partner-data`, mounted at `/data` in the container. Docker creates and manages the volume; no host bind path or `driver_opts.device` is required.

On start, the image entrypoint (as root) runs `chown -R ppuser:ppuser /data`, then drops to `ppuser` before starting Node. Fresh named volumes that are root-owned (common on Docker Desktop) are fixed automatically. Do not set `user: "1000:1000"` in Compose, or that chown is skipped.

```bash
# Inspect the named volume (path is under Docker's volume store)
docker volume inspect print-partner-data

# Data survives container restarts and upgrades
# (docker compose down does not delete the volume)
```

### Authentication and Reverse Proxies

The local commands in this guide rely on a direct, unambiguous loopback
connection. Loopback access is not inferred from `Origin`, `Referer`,
`Sec-Fetch-*`, or forwarded headers.

For any remote or reverse-proxy deployment:

1. Configure `PRINT_PARTNER_API_KEY`/`INTEGRATION_API_KEY`, Basic
   authentication, or multi-user authentication.
2. Set `TRUST_PROXY=1` only for a controlled proxy.
3. Send API credentials explicitly, for example:

   ```bash
   curl -H "Authorization: Bearer $PRINT_PARTNER_API_KEY" \
     https://print-partner.example.com/api/v1/plans
   ```

Proxy trust, required authentication, or forwarding headers disable the
unauthenticated loopback shortcut. This prevents a local proxy's socket address
from authorizing its remote clients. Administrative routes (backups, API-key
settings, logging, integrations, webhooks, and `/admin/*`) require a valid API
key, configured Basic credentials, or an administrator session when the
shortcut is disabled.

All API keys currently have full administrator authority; key roles/scopes are
not part of the current API model. Store keys as secrets and issue separate
keys when independent revocation is needed.

## Daily Operations

### Check System Status

<!-- release-version:start -->
```bash
# Health check
curl http://localhost:8080/health | jq .

# Expected response:
# {
#   "ok": true,
#   "version": "3.2.0-web",
#   "release": {
#     "version": "3.2.0",
#     "commit": "abc1234...",
#     "tag": "v3.2.0",
#     "deployment_mode": "self-host"
#   },
#   "db": { "connected": true, "driver": "sqlite" },
#   "capabilities": [...],
#   "semver": "v3.2.0+abc1234"
# }
```
<!-- release-version:end -->

### Create Backups

Backups are recommended before:
- Updates to a new version
- Major configuration changes
- Testing new integrations

```bash
# Create backup
BACKUP_ID=$(curl -s -X POST http://localhost:8080/backups | jq -r '.id')
echo "Backup created: $BACKUP_ID"

# List all backups
curl http://localhost:8080/backups | jq .

# Download backup file
curl http://localhost:8080/backups/2026-08-15T18-20-00Z.tar.gz \
  --output ~/print-partner-backup.tar.gz
```

### Monitor Logs

```bash
# Get log statistics
curl http://localhost:8080/settings/logging/stats | jq .

# View recent logs
curl http://localhost:8080/settings/logging/logs?limit=20 | jq .

# Filter by severity
curl 'http://localhost:8080/settings/logging/logs?severity=error' | jq .

# Filter by method
curl 'http://localhost:8080/settings/logging/logs?method=POST' | jq .

# Export all logs
curl http://localhost:8080/settings/logging/export?format=jsonl > logs.jsonl
```

### API Key Management

```bash
# Generate new key
curl -X POST http://localhost:8080/settings/api-keys | jq .
# Response includes plaintext "key" field (shown only once!)

# List all keys
curl http://localhost:8080/settings/api-keys | jq .

# Rotate a key (create new, deactivate old)
curl -X POST http://localhost:8080/settings/api-keys/key_abc123/regenerate | jq .

# Revoke a key
curl -X DELETE http://localhost:8080/settings/api-keys/key_abc123
```

### Manage Webhooks

```bash
# List webhooks
curl http://localhost:8080/api/v1/webhooks | jq .

# Register webhook
curl -X POST http://localhost:8080/api/v1/webhooks \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com/webhook",
    "events": ["job.done", "job.error"],
    "secret": "your-secret-key"
  }' | jq .

# Delete webhook
curl -X DELETE http://localhost:8080/api/v1/webhooks/wh-abc123
```

## Maintenance

### Container Logs

```bash
# Follow live logs
docker compose logs -f

# Last 50 lines
docker compose logs --tail 50

# Specific service
docker compose logs print-partner
```

### Database Maintenance

SQLite (default) is self-maintaining. For long-running instances:

```bash
# Create a backup before any maintenance
curl -X POST http://localhost:8080/backups

# Check database integrity (inside container)
docker compose exec print-partner sqlite3 /data/primary.db "PRAGMA integrity_check;"
```

### Disk Space

Monitor `/data` directory usage inside the container (or via the named volume):

```bash
# Check size inside the running container
docker compose exec print-partner du -sh /data

# Typical sizes:
# - primary.db: 50-500 MB (depends on job history)
# - backups/: 5-50 MB (gzip compressed)
# - logs: In-memory only (max 10,000 entries)
```

If disk usage is high:
1. Export and clear logs: `POST /settings/logging/export` → `DELETE /settings/logging/logs`
2. Archive old backups to S3/external storage
3. Create a final backup before cleanup
4. Consider PostgreSQL for long-term growth

## Upgrades

### Prepare for Upgrade

```bash
# Create backup
curl -X POST http://localhost:8080/backups

# Export logs (optional)
curl http://localhost:8080/settings/logging/export?format=jsonl > logs-backup.jsonl

# Review changelog
# https://github.com/poitee/PrintPartnerPartner/blob/main/CHANGELOG.md
```

### Perform Upgrade

```bash
# Pull latest image
docker pull ghcr.io/poitee/print-partner:latest

# Recreate container
docker compose down
docker compose up -d

# Wait for health check
sleep 5
curl http://localhost:8080/health

# Verify logs for errors
docker compose logs | tail -20
```

### Rollback (if needed)

```bash
# Restore from backup
curl -X POST http://localhost:8080/backups/restore \
  -H 'Content-Type: application/json' \
  -d '{"backupName":"2026-08-15T18-20-00Z.tar.gz"}'

# Container will restart with old data
docker compose down
docker compose up -d
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose logs print-partner

# Common issues:
# 1. Port 8080 in use
sudo netstat -tulpn | grep 8080

# 2. Permission issues on /data (named volume; check inside the container)
docker compose exec print-partner ls -la /data
# Entrypoint chowns /data to ppuser on start when the container begins as root.
# Fresh named volumes are often root-owned until that chown runs — do not set
# user: "1000:1000" in compose (that skips chown and causes EACCES on /data/repos).
# For a host bind mount instead, see NON_ROOT_SETUP.md Option 2.

# 3. Corrupted database
# Restore from backup:
curl -X POST http://localhost:8080/backups/restore \
  -H 'Content-Type: application/json' \
  -d '{"backupName":"2026-08-15T18-20-00Z.tar.gz"}'
```

### High Memory Usage

```bash
# Check logs stats
curl http://localhost:8080/settings/logging/stats

# If logs are full (10,000 max):
# 1. Export
curl http://localhost:8080/settings/logging/export?format=jsonl > logs.jsonl

# 2. Clear
curl -X DELETE http://localhost:8080/settings/logging/logs

# 3. Reduce verbosity (optional)
curl -X POST http://localhost:8080/settings/logging/config \
  -H 'Content-Type: application/json' \
  -d '{"minSeverity":"warn"}'
```

### Slow Printer Operations

```bash
# Enable debug logging
curl -X POST http://localhost:8080/settings/logging/config \
  -H 'Content-Type: application/json' \
  -d '{"minSeverity":"debug"}'

# Make a request to the slow operation
# Then check logs
curl http://localhost:8080/settings/logging/logs?severity=debug | jq '.[] | select(.context.webhookId)'

# Look for:
# - Network timeouts
# - SSRF rejections
# - Malformed responses
# - Integration errors

# Reduce verbosity when done
curl -X POST http://localhost:8080/settings/logging/config \
  -H 'Content-Type: application/json' \
  -d '{"minSeverity":"info"}'
```

### Webhook Delivery Failures

```bash
# Check webhook registrations
curl http://localhost:8080/api/v1/webhooks | jq .

# View webhook logs
curl http://localhost:8080/settings/logging/logs | jq '.[] | select(.context.webhookId)'

# Look for:
# - SSRF rejections: "URL resolves to a private or internal address"
# - Timeout: "Webhook delivery failed: job.done"
# - Redirect loops: "Too many redirects"
# - Authentication: 401/403 status codes

# Verify webhook URL is accessible
curl -I https://your-webhook.example.com/endpoint

# Test with secret signature verification
curl -X POST https://your-webhook.example.com/endpoint \
  -H 'Content-Type: application/json' \
  -H 'X-Print-Partner-Event: job.done' \
  -H 'X-Print-Partner-Signature: sha256=...' \
  -d '{"event":"job.done","jobId":"..."}'
```

### API Key Not Working

```bash
# List keys
curl http://localhost:8080/settings/api-keys | jq .

# Check if key is active
curl http://localhost:8080/settings/api-keys | jq '.keys[] | {id, isActive, createdAt, lastUsedAt}'

# Test authentication
curl -H "Authorization: Bearer ppk_your_key" \
  http://localhost:8080/api/v1/plans

# If 401 Unauthorized:
# 1. Verify key is active
# 2. Check key format (ppk_* for API, not UI tokens)
# 3. Regenerate if suspected compromise
curl -X POST http://localhost:8080/settings/api-keys/key_abc123/regenerate
```

## Monitoring Setup

### Container Health Checks

Docker compose includes health checks:
```bash
# View health status
docker compose ps

# Expected output:
# STATUS: Up 2 hours (healthy)

# If unhealthy
docker compose logs print-partner | tail -20
```

### External Monitoring (Prometheus, Datadog, etc.)

Export logs regularly for external monitoring:

```bash
# Daily export job (systemd timer or cron)
#!/bin/bash
DATE=$(date +%Y-%m-%d)
curl http://localhost:8080/settings/logging/export?format=jsonl \
  > /var/log/print-partner/daily-$DATE.jsonl

# Upload to S3
aws s3 cp /var/log/print-partner/daily-$DATE.jsonl \
  s3://monitoring-bucket/print-partner/$DATE/

# Clear logs from app (optional)
curl -X DELETE http://localhost:8080/settings/logging/logs
```

### Alert Thresholds

Create alerts for:
- **Health check failures**: Container not responding to `/health`
- **High error rate**: Error severity logs > 10 in 1 hour
- **Webhook delivery failures**: Failed status codes in webhook logs
- **API key rotation**: Unused keys > 90 days

## Migration & Scaling

### SQLite → PostgreSQL

For multi-user or high-concurrency deployments:

```bash
# 1. Create backup of SQLite
curl -X POST http://localhost:8080/backups

# 2. Stop current deployment
docker compose down

# 3. Set up PostgreSQL
export DATABASE_URL=postgresql://user:pass@postgres-host:5432/print_partner

# 4. Use SaaS compose file
docker compose -f docker-compose.saas.yml up -d

# 5. Database tables auto-created on first start
curl http://localhost:8080/health

# 6. Can migrate data from SQLite backup if needed
```

### Multi-Instance Deployment

Print Partner can run in multi-instance mode with shared database:

```yaml
# docker-compose.yml (load-balanced)
services:
  app-1:
    image: ghcr.io/poitee/print-partner:latest
    environment:
      DATABASE_URL: postgresql://user:pass@postgres:5432/print_partner
      PORT: 8081
  
  app-2:
    image: ghcr.io/poitee/print-partner:latest
    environment:
      DATABASE_URL: postgresql://user:pass@postgres:5432/print_partner
      PORT: 8082
  
  nginx:
    image: nginx:latest
    ports:
      - "8080:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
```

---

Last updated: August 15, 2026  
<!-- release-version:start -->
Prepared for: 3.2.0
<!-- release-version:end -->

For more info: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](../SECURITY.md)
