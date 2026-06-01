# Changelog — Print Partner Web

## v1.0.0-web (2026-05-31)

### Added

- Postgres-backed app data when `DEPLOY_MODE=saas` and `DATABASE_URL` (sync bridge for Drizzle)
- Tenant-scoped queries and isolation tests
- Plan routes: PATCH rename, duplicate, layer PUT/DELETE, kit-manifest, manifest-v2, plan-manifest-builder
- Stack preset apply from kit catalog
- Custom filaments CRUD (JSON store under data dir)
- Repo manifest read/write and manifest builder bootstrap
- Legal document routes
- Bambu Studio metadata stubs in 3MF export (`Metadata/plate_1.json`, `slice_info.config`)
- HTML checklist embeds client-cached thumbnails when present
- Production config validation (`SESSION_SECRET`, `ALLOWED_ORIGINS`)
- Smoke checklist (`web/scripts/SMOKE_CHECKLIST.md`)

### Changed

- Unified `DatabaseBundle` with sqlite (self-host) or postgres (SaaS) drivers
- Health payload includes `db.driver` and postgres connectivity
