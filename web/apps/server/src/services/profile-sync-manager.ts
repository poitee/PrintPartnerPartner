import type { AppRepository } from "../db/repository.js";
import {
  buildProfileSyncSettings,
  buildProfileSyncSettingsFromInstances,
  startProfileSyncWatcher,
  type ProfileSyncEmitter,
} from "./profile-sync.js";

type WatcherHandle = { stop: () => void; syncAll: () => Promise<void> };

let handle: WatcherHandle | null = null;
let emit: ProfileSyncEmitter = () => {};
let repo: AppRepository | null = null;

export function startManagedProfileSync(
  repository: AppRepository,
  emitter: ProfileSyncEmitter,
): WatcherHandle {
  repo = repository;
  emit = emitter;
  handle = startProfileSyncWatcher(repository, resolveSettings(repository), emitter);
  return {
    stop: () => {
      handle?.stop();
      handle = null;
    },
    syncAll: async () => {
      await handle?.syncAll();
    },
  };
}

function resolveSettings(repository: AppRepository) {
  const instances = repository.listSlicerInstances();
  if (instances.length > 0) {
    return buildProfileSyncSettingsFromInstances(
      instances.map((row) => ({
        enabled: row.enabled,
        dialect: row.dialect,
        watch_path: row.watchPath,
      })),
    );
  }
  return buildProfileSyncSettings(process.env);
}

/** Stop and restart watchers from the current instance table (best-effort). */
export function reloadManagedProfileSync(): void {
  if (!repo) return;
  handle?.stop();
  handle = startProfileSyncWatcher(repo, resolveSettings(repo), emit);
  void handle.syncAll();
}
