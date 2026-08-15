# Non-Root Execution Setup Guide

Print Partner now runs as `ppuser` (uid 1000) for enhanced security. This guide explains how to set up proper volume permissions.

## Overview

The Docker image includes:
- **ppuser user** (uid 1000, gid 1000) for non-root execution
- **dumb-init** for proper PID 1 signal handling
- **Minimal attack surface** — can't escape to host root

## Setup Options

### Option 1: Automatic Volume Setup (Recommended)

Docker Compose will create a named volume with correct permissions:

```bash
docker compose up -d
```

Docker automatically handles permissions for named volumes. The container runs as ppuser (1000:1000) and owns `/data` inside the volume.

**Pros:** Simple, works out-of-the-box  
**Cons:** Volume path managed by Docker

### Option 2: Bind Mount with Manual Permissions

If you prefer bind mounts (direct host directory access):

```bash
# Create data directory
mkdir -p ~/print-partner-data

# Set permissions for uid 1000
sudo chown 1000:1000 ~/print-partner-data
sudo chmod 755 ~/print-partner-data

# Update docker-compose.yml
# volumes:
#   - ~/print-partner-data:/data
```

Then start:
```bash
docker compose up -d
```

**Pros:** Full control, easy backup/restore  
**Cons:** Requires manual permission setup

### Option 3: User Namespaces (Advanced)

For extra isolation on multi-user hosts:

```bash
# Edit /etc/docker/daemon.json
{
  "userns-remap": "default"
}

# Restart Docker
sudo systemctl restart docker
```

Then permissions are automatically remapped. The host directory owner doesn't need to match.

**Pros:** Additional security isolation  
**Cons:** Requires daemon restart, affects all containers

## Verification

Verify non-root execution:

```bash
# Check running user
docker compose exec print-partner id
# Output: uid=1000(ppuser) gid=1000(ppuser) groups=1000(ppuser)

# Check file permissions
docker compose exec print-partner ls -la /data
# Output: drwxr-xr-x ppuser ppuser 4096 Aug 15 18:20 /data
```

## Troubleshooting

### Permission Denied on Bind Mount

**Problem:** `attempt to write a readonly database`

**Solution:**
```bash
# Set correct ownership on host directory
sudo chown 1000:1000 ~/print-partner-data
sudo chmod 755 ~/print-partner-data

# Or use named volume instead (auto-handled by Docker)
```

### Container Won't Start

**Problem:** `permission denied` on startup

**Check logs:**
```bash
docker compose logs print-partner | grep -i permission
```

**Solutions:**
1. Use named volume (automatic permissions)
2. Manually fix host directory permissions
3. Fall back to root: remove `user: "1000:1000"` from compose file

### Can't Write to /data from Host

**Problem:** Host user can't read/write files created by ppuser

**Solution 1:** Use the same uid locally (if available):
```bash
# Add your user to group 1000
sudo usermod -aG 1000 $USER
# Log out and back in

# Files created by container are accessible
ls -la ~/print-partner-data
```

**Solution 2:** Use a separate data user:
```bash
# Create matching user on host
sudo useradd -u 1000 ppuser
sudo usermod -d /var/lib/print-partner ppuser

# Set directory permissions
sudo chown ppuser:ppuser /var/lib/print-partner
```

**Solution 3:** Allow read-only access:
```bash
# Make container data readable by host
sudo chmod 755 ~/print-partner-data
# (Files inside will need explicit permissions)
```

## Security Benefits

Running as non-root provides:

✅ **Escape containment:** Container process can't gain host root  
✅ **File isolation:** Can't write to system directories  
✅ **Process isolation:** Signal handling properly contained  
✅ **Standard practice:** Follows Docker security best practices  

## Production Recommendation

For production deployments:

1. **Use named volumes** — Docker handles permissions automatically
2. **Enable user namespaces** — Extra isolation layer
3. **Regular backups** — Export backups to S3/external storage
4. **Monitor logs** — Check for permission issues

Example production compose:

```yaml
services:
  print-partner:
    image: ghcr.io/poitee/print-partner:latest
    user: "1000:1000"
    volumes:
      - print-partner-data:/data
    # ... rest of config
    
volumes:
  print-partner-data:
    driver: local
```

## Rollback to Root (if needed)

If you encounter persistent permission issues:

```yaml
# In docker-compose.yml, remove the user line:
# user: "1000:1000"  <- DELETE THIS LINE

docker compose down
docker compose up -d
```

This is temporary — please report permission issues so we can improve the setup!

---

**Questions?** See [OPERATIONS.md](OPERATIONS.md) for troubleshooting or [SECURITY.md](SECURITY.md) for security details.
