# Non-Root Execution Setup Guide

Print Partner runs as `ppuser` (uid 1000) after startup for enhanced security. This guide explains how volume permissions work.

## Overview

The Docker image includes:
- **ppuser user** (uid 1000, gid 1000) for non-root execution
- **Entrypoint** that starts as root, `chown`s `/data`, then drops to ppuser via `gosu`
- **dumb-init** for proper PID 1 signal handling
- **Minimal attack surface** — runtime process can't escape to host root

## How `/data` permissions work

Fresh **named volumes** are often root-owned (especially on Docker Desktop). The image's build-time `chown /data` is hidden when the volume mounts over `/data`.

On every start as root, `docker-entrypoint.sh`:

1. `mkdir -p /data`
2. `chown -R ppuser:ppuser /data`
3. Drops privileges and runs `dumb-init -- node dist/index.js` as ppuser

If the container is already non-root (e.g. you set `user:` yourself), the entrypoint skips chown and just execs the command.

**Do not** set `user: "1000:1000"` in Compose for the default setup — that prevents the entrypoint from fixing a root-owned volume and causes `EACCES: permission denied, mkdir '/data/repos'`.

## Setup Options

### Option 1: Named volume (Recommended)

```bash
docker compose up -d
```

Compose creates the `print-partner-data` named volume and mounts it at `/data`. The entrypoint owns `/data` for ppuser on start; the Node process then runs as uid 1000.

**Pros:** Simple, works out-of-the-box on Linux and Docker Desktop  
**Cons:** Volume path managed by Docker

### Option 2: Bind Mount with Manual Permissions

If you prefer bind mounts (direct host directory access):

```bash
# Create data directory
mkdir -p ~/print-partner-data

# Set permissions for uid 1000 (still useful for host access)
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

The entrypoint will still chown `/data` when starting as root. Preparing the host directory keeps files readable/writable from the host as uid 1000.

**Pros:** Full control, easy backup/restore  
**Cons:** Requires host path setup

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

Verify non-root execution of the **app process** (the image starts as root so the entrypoint can chown `/data`; `docker compose exec … id` therefore shows root and is not the right check):

```bash
# App process must be ppuser (uid 1000), not root
docker top "$(docker compose ps -q print-partner)" -eo uid,user,pid,cmd
# Expect: uid 1000, user ppuser (or numeric 1000), cmd includes "node dist/index.js"

# Or from /proc inside the container:
docker compose exec print-partner sh -c 'awk "/^Uid:/{print \$2}" /proc/1/status'
# Output: 1000

# Check file permissions
docker compose exec print-partner ls -la /data
# Output: drwxr-xr-x ppuser ppuser ... /data  (and repos/, etc.)
```

## Troubleshooting

### Permission Denied on `/data` (EACCES mkdir '/data/repos')

**Cause:** Container started as uid 1000 with a root-owned named volume (entrypoint could not chown).

**Solution:**
1. Ensure `docker-compose.yml` does **not** set `user: "1000:1000"`.
2. Rebuild/restart so the entrypoint runs as root first:
```bash
docker compose down
docker compose up -d --build
```

### Permission Denied on Bind Mount

**Problem:** `attempt to write a readonly database`

**Solution:**
```bash
# Set correct ownership on host directory
sudo chown 1000:1000 ~/print-partner-data
sudo chmod 755 ~/print-partner-data
```

### Container Won't Start

**Problem:** `permission denied` on startup

**Check logs:**
```bash
docker compose logs print-partner | grep -i permission
```

**Solutions:**
1. Confirm the image entrypoint is used (no `user:` override that blocks chown)
2. For bind mounts, fix host directory permissions (Option 2)
3. Inspect ownership inside the container after start: `docker compose exec print-partner ls -la /data`

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

1. **Use named volumes** — entrypoint chowns `/data` on start; process runs as ppuser
2. **Enable user namespaces** — Extra isolation layer
3. **Regular backups** — Export backups to S3/external storage
4. **Monitor logs** — Check for permission issues

Example production compose:

```yaml
services:
  print-partner:
    image: ghcr.io/poitee/print-partner:latest
    # Do not set user: — entrypoint must start as root to chown /data
    volumes:
      - print-partner-data:/data
    # ... rest of config
    
volumes:
  print-partner-data:
```

## Forcing a fixed uid (advanced)

Only set `user: "1000:1000"` if `/data` is already owned by uid 1000 (e.g. a prepared bind mount). With that override the entrypoint cannot chown, so a root-owned empty named volume will fail with EACCES.

---

**Questions?** See [OPERATIONS.md](OPERATIONS.md) for troubleshooting or [SECURITY.md](SECURITY.md) for security details.
