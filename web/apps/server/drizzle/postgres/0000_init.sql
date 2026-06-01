CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'git',
  branch TEXT NOT NULL DEFAULT 'main',
  local_path TEXT,
  last_synced_at TEXT,
  last_commit_sha TEXT,
  docs_url TEXT,
  imported_paths TEXT,
  manifest_community_slug TEXT,
  source_kind TEXT NOT NULL DEFAULT 'github',
  role TEXT NOT NULL DEFAULT 'unassigned',
  metadata_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_tenant_name ON projects (tenant_id, name);

CREATE TABLE IF NOT EXISTS build_profiles (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  order_number TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_tenant_name ON build_profiles (tenant_id, name);

CREATE TABLE IF NOT EXISTS profile_layers (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  profile_id INTEGER NOT NULL REFERENCES build_profiles(id) ON DELETE CASCADE,
  layer_order INTEGER NOT NULL DEFAULT 0,
  layer_type TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS parts (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  profile_id INTEGER NOT NULL REFERENCES build_profiles(id) ON DELETE CASCADE,
  match_key TEXT NOT NULL,
  relative_path TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  source_layer TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'base',
  role TEXT NOT NULL DEFAULT 'primary',
  filament_color_id TEXT,
  filament_custom_hex TEXT,
  quantity_auto INTEGER NOT NULL DEFAULT 1,
  quantity_override INTEGER,
  quantity_effective INTEGER NOT NULL DEFAULT 1,
  included BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NOT NULL DEFAULT '',
  github_blob_url TEXT,
  geometry_same BOOLEAN,
  requirement TEXT,
  option_group_id TEXT,
  manifest_source TEXT
);

CREATE TABLE IF NOT EXISTS print_progress (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  unit_index INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_print_progress_part_unit ON print_progress (part_id, unit_index);

CREATE TABLE IF NOT EXISTS app_settings (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, key)
);
