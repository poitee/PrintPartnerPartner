# Print Partner Security Guidelines

Comprehensive security documentation for Print Partner operators and developers.

## Deployment Security

### Trusted Network Assumption

Print Partner is designed for **trusted LAN environments** by default:

- ✅ **No authentication required** on localhost/LAN (default)
- ✅ **No TLS enforcement** on trusted networks
- ❌ **Not suitable** for internet-facing deployments without auth/TLS

If exposing to the internet:
1. Enable authentication via environment variables
2. Place behind reverse proxy with TLS (nginx, Cloudflare)
3. Use strong API keys for integrations
4. Monitor logs for suspicious activity

### Container Execution

The Docker image starts as root only long enough for the entrypoint to prepare `/data`, then drops to:

```text
ppuser  # Non-root, uid 1000 (via gosu after chown)
```

Benefits:
- Escape from container cannot gain root on host (runtime process is non-root)
- Process cannot write to system directories
- Standard Linux security model applies

### Data Directory Permissions

On start, the entrypoint ensures `/data` is owned by:
- Owner: ppuser:ppuser (uid 1000:1000)
- Permissions: typically drwxr-xr-x (755) after chown

Default Compose uses a **named volume** (`print-partner-data`). Named volumes are **not** automatically owned by ppuser — especially on Docker Desktop, a fresh volume is often root-owned. The entrypoint `chown`s `/data` before dropping privileges. Do not set `user: "1000:1000"` in Compose for this path.

If you switch to a **host bind mount** instead (see `NON_ROOT_SETUP.md` Option 2), prepare the host directory for uid 1000:

```bash
sudo chown 1000:1000 ~/print-partner-data
sudo chmod 755 ~/print-partner-data
```

## Network Security

### SSRF Protection

All outbound HTTP requests validate target addresses:

**Blocked addresses (always):**
- Cloud metadata: 169.254.169.254 (AWS, GCP, Azure)
- IPv6 metadata: fd00:ec2::254
- localhost/loopback: 127.0.0.0/8, ::1
- Multicast: 224.0.0.0/4, ff00::/8

**Blocked by default (allowed with `allowPrivate: true`):**
- RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
- CGNAT: 100.64.0.0/10
- Link-local: 169.254.0.0/16
- ULA: fc00::/7

**Use case:** Printer integrations (Bambu, Moonraker) on private IPs use `allowPrivate: true`

Implementation: `web/apps/server/src/lib/outbound-url.ts`

### Webhook Validation

When registering webhooks:

```bash
curl -X POST http://localhost:8080/webhooks \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com/webhook",
    "events": ["job.done"],
    "secret": "your-webhook-secret"
  }'
```

Security checks:
1. **SSRF validation**: URL checked against blocked ranges
2. **Redirect validation**: Every redirect hop validated
3. **Timeout protection**: 10-second delivery timeout
4. **HMAC signing**: Events signed with secret (not sent in plaintext)

**Webhook signature verification:**

```python
import hmac
import hashlib

def verify_webhook(request_body, signature_header, secret):
    expected = "sha256=" + hmac.new(
        secret.encode(),
        request_body.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature_header, expected)
```

## API Security

### API Keys

Generate a new key:
```bash
curl -X POST http://localhost:8080/settings/api-keys
# Response: { "id": "key_abc123", "key": "ppk_...", "createdAt": "..." }
```

Key properties:
- **Format**: ppk_* (32 bytes random)
- **Storage**: Hashed (not plaintext in database)
- **Tracking**: Last-used timestamp recorded
- **Rotation**: Regenerate endpoint creates new key, marks old as inactive

Use key in requests:
```bash
curl http://localhost:8080/api/v1/plans \
  -H "Authorization: Bearer ppk_..."
```

### Key Rotation

Rotate a key (creates new, deactivates old):
```bash
curl -X POST http://localhost:8080/settings/api-keys/key_abc123/regenerate
```

Revoke a key (deactivate without deletion):
```bash
curl -X DELETE http://localhost:8080/settings/api-keys/key_abc123
```

Never share keys in:
- Source code (use environment variables)
- Logs (redacted from workflow logger)
- Browser console (keep in backend/secrets manager)
- Version control (use .env, add to .gitignore)

## Database Security

### SQLite (Default)

SQLite provides:
- ✅ **File-based**: Single database file on disk
- ✅ **ACID**: Atomic transactions
- ❌ **No authentication**: Relies on file system permissions
- ❌ **Single writer**: Concurrent writes may contend

Secure deployment:
```bash
# Host permissions (before mounting)
sudo chown 1000:1000 /data/primary.db
sudo chmod 640 /data/primary.db  # ppuser can read/write
```

### PostgreSQL (SaaS/Multi-user, experimental)

The current Postgres repository uses a synchronous compatibility bridge without
native repository transaction semantics. It is not production-ready. SQLite
remains the supported database; production startup with Postgres requires an
explicit `POSTGRES_EXPERIMENTAL=1` acknowledgement.

For isolated development:
```bash
export DATABASE_URL=postgresql://user:pass@postgres:5432/print_partner
docker compose -f docker-compose.saas.yml up
```

PostgreSQL provides:
- ✅ **Multi-user**: Row-level security possible
- ✅ **Concurrent writes**: Better than SQLite
- ✅ **Network security**: Separate database server
- ⚠️ **Network exposure**: Requires secure networking

## Backup & Restore Security

### Backup Contents

Backups contain:
- SQLite database (primary.db)
- WAL and SHM files
- No application secrets (passwords stay in memory)
- No API keys (stored as hashes only)

### Safe Restore

Restore process:
1. **Pre-restore backup** created automatically
2. **Validation**: Checksum verified
3. **Atomic**: Full database replaced on success
4. **Rollback**: Prior backup preserved if restore fails

Restore a backup:
```bash
# Get list
curl http://localhost:8080/backups

# Restore
curl -X POST http://localhost:8080/backups/restore \
  -H 'Content-Type: application/json' \
  -d '{"backupName": "2026-08-15T18-20-00Z.tar.gz"}'

# If restore fails, old state is preserved
```

### Backup Storage

Backups live under `/data/backups/` inside the container (named volume `print-partner-data`). Inspect the volume mount path with:

```bash
docker volume inspect print-partner-data
```

Secure backup storage:
1. **Encrypt at rest** (filesystem encryption, e.g. LUKS)
2. **Restrict access** (only ppuser can read)
3. **Archive offsite** (periodic S3/B2 sync)
4. **Version control** (keep 30+ days of backups)

## Logging & Monitoring

### Workflow Logs

Logs capture:
- HTTP request/response (method, URL, status, duration)
- Request context (params, query, user ID)
- Integration events (webhook delivery, API calls)
- Errors and warnings

**Sensitive data is NOT logged:**
- API key values (only key ID)
- Request bodies (only metadata)
- Authentication credentials
- Webhook secrets

Configure logging:
```bash
# Set level
curl -X POST http://localhost:8080/settings/logging/config \
  -H 'Content-Type: application/json' \
  -d '{"minSeverity":"warn","enableWorkflowTracking":true}'

# Get stats
curl http://localhost:8080/settings/logging/stats

# Export for analysis
curl http://localhost:8080/settings/logging/export?format=jsonl > logs.jsonl
```

### Log Retention

Logs are stored in memory (10,000 max). To prevent overflow:
1. Export regularly: `POST /settings/logging/export`
2. Clear logs: `DELETE /settings/logging/logs`
3. Reduce verbosity: Set `minSeverity=warn` or higher

## Incident Response

### Suspicious Activity

If you suspect a compromise:

1. **Stop the container**
   ```bash
   docker compose down
   ```

2. **Inspect logs**
   ```bash
   curl http://localhost:8080/settings/logging/logs?limit=1000 > incident-logs.json
   ```

3. **Check API keys**
   ```bash
   curl http://localhost:8080/settings/api-keys
   # Look for unexpected keys or high-usage keys
   ```

4. **Revoke compromised keys**
   ```bash
   curl -X DELETE http://localhost:8080/settings/api-keys/key_abc123
   ```

5. **Restore from backup**
   ```bash
   curl -X POST http://localhost:8080/backups/restore \
     -H 'Content-Type: application/json' \
     -d '{"backupName":"2026-08-15T18-20-00Z.tar.gz"}'
   ```

6. **Review webhook registrations**
   ```bash
   curl http://localhost:8080/webhooks
   # Remove any suspicious URLs
   curl -X DELETE http://localhost:8080/webhooks/wh-abc123
   ```

## Development Security

### Code Review Checklist

When adding features, check for:

- [ ] **SSRF validation** on all outbound URLs
  ```typescript
  import { assertSafeOutboundUrl } from "../lib/outbound-url.js";
  await assertSafeOutboundUrl(userSuppliedUrl);
  ```

- [ ] **Input validation** on all user inputs
  ```typescript
  if (!email.includes("@")) {
    return sendProblem(reply, 400, "Bad Request", "Invalid email");
  }
  ```

- [ ] **Logging** of important operations
  ```typescript
  logger.logWorkflow({
    method: "POST",
    url: "/api/v1/plans",
    statusCode: 201,
    severity: "info",
  });
  ```

- [ ] **Error handling** without leaking details
  ```typescript
  try {
    // ...
  } catch (error) {
    return sendProblem(reply, 500, "Internal Server Error", "Request failed");
    // Don't expose error.message to client
  }
  ```

- [ ] **Tests passing** before merge
  ```bash
  cd web
  npm run quality
  ```

### Security Dependencies

Keep dependencies updated:
```bash
cd web
npm ci
npm audit --audit-level=high
npm update
git add package-lock.json
git commit -m "chore: security updates"
```

GitHub Actions enforces the high-severity npm audit gate. No Snyk organization
or Snyk CI check is configured for this repository.

## Compliance Considerations

### GDPR

Print Partner stores:
- Print job metadata (duration, status, file names)
- Integration credentials (in memory)
- Logs (in memory, not persisted)

To comply with data retention requirements:
1. Configure log export/clear regularly
2. Backup control: Users own backups on their host
3. Data deletion: Clear logs, restore from backup, or delete `/data`

### Audit Logs

For audit purposes, export and archive logs:
```bash
# Daily export
curl http://localhost:8080/settings/logging/export?format=jsonl \
  > logs-$(date +%Y-%m-%d).jsonl

# Archive to S3
aws s3 cp logs-*.jsonl s3://archive-bucket/print-partner/
```

---

Last updated: August 15, 2026  
Version: 3.0.0+main
