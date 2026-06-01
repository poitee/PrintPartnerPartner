/** Optional Tauri runtime — not bundled in the web SPA; dynamic import only. */
declare module "@tauri-apps/api/core" {
  export function invoke<T>(
    cmd: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
}
