/** Public support / donation links (mirrors src/print_partner/support_links.py). */
export const KOFI_URL = "https://ko-fi.com/poitee";
export const KOFI_BUTTON_LABEL = "Buy me a Coffee";

/** Open Ko-fi in a new browser tab. */
export function openKofi(): void {
  window.open(KOFI_URL, "_blank", "noopener,noreferrer");
}
