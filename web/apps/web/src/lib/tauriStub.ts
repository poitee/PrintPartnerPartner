/** Web build stub — Tauri is desktop-only; callers fall back to browser APIs. */
export async function invoke<T>(
  _cmd: string,
  _args?: Record<string, unknown>,
): Promise<T> {
  throw new Error("Tauri runtime not available");
}
