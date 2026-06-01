/** Public support / donation links (mirrors src/print_partner/support_links.py). */
export const KOFI_URL = "https://ko-fi.com/poitee";
export const KOFI_BUTTON_LABEL = "Buy me a Coffee";

/** Open Ko-fi in the system browser (Tauri) or a new tab (Vite dev). */
export async function openKofi(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_path_in_shell", { path: KOFI_URL });
  } catch {
    window.open(KOFI_URL, "_blank", "noopener,noreferrer");
  }
}
