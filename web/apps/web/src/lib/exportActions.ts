import { toast } from "sonner";
import { openPathInShell } from "../api/engine";
import { parentDirectory } from "./exportPaths";

export type ExportCompleteOptions = {
  /** When true, path is a directory; primary action opens that folder. */
  isDirectory?: boolean;
};

/** Toast with open-file / open-folder actions after an export completes. */
export function notifyExportComplete(
  title: string,
  filePath: string,
  options?: ExportCompleteOptions,
): void {
  if (options?.isDirectory) {
    toast.success(title, {
      description: filePath,
      duration: 12_000,
      action: {
        label: "Open folder",
        onClick: () => void openPathInShell(filePath),
      },
    });
    return;
  }

  const folder = parentDirectory(filePath);
  toast.success(title, {
    description: filePath,
    duration: 12_000,
    action: {
      label: "Open file",
      onClick: () => void openPathInShell(filePath),
    },
    cancel: {
      label: "Open folder",
      onClick: () => void openPathInShell(folder),
    },
  });
}
