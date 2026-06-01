import { toast } from "sonner";
import { downloadExport, openPathInShell } from "../api/engine";
import { parentDirectory } from "./exportPaths";

export type ExportCompleteOptions = {
  /** When true, path is a directory; primary action opens that folder. */
  isDirectory?: boolean;
};

export type ExportJobResult = Record<string, unknown> | null | undefined;

type CompleteExportOptions = {
  pathField?: "path" | "root_path" | "primary_path";
  isDirectory?: boolean;
  suggestedFilename?: string;
};

function pathFromResult(result: ExportJobResult, field: string): string | undefined {
  const v = result?.[field];
  return typeof v === "string" ? v : undefined;
}

/** Prefer browser download via download_url; fall back to desktop open-in-shell. */
export function completeExportDownload(
  title: string,
  result: ExportJobResult,
  options?: CompleteExportOptions,
): void {
  const pathField = options?.pathField ?? "path";
  const downloadUrl = result?.download_url;
  if (typeof downloadUrl === "string") {
    downloadExport(downloadUrl, options?.suggestedFilename);
    toast.success(`${title} downloaded`);
    return;
  }

  const filePath =
    pathFromResult(result, pathField) ??
    pathFromResult(result, "primary_path") ??
    pathFromResult(result, "root_path") ??
    pathFromResult(result, "path");

  if (typeof filePath === "string") {
    notifyExportComplete(title, filePath, { isDirectory: options?.isDirectory });
    return;
  }

  toast.success(title);
}

/** Download multiple files when the job result includes per-file download_url entries. */
export function completeMultiFileExportDownload(title: string, result: ExportJobResult): void {
  const paths = result?.paths as Array<{ download_url?: string }> | undefined;
  if (Array.isArray(paths)) {
    let count = 0;
    for (const entry of paths) {
      if (typeof entry.download_url === "string") {
        downloadExport(entry.download_url);
        count++;
      }
    }
    if (count > 0) {
      toast.success(`${title}: ${count} file(s) downloaded`);
      return;
    }
  }
  completeExportDownload(title, result, { pathField: "primary_path" });
}

/** Toast with open-file / open-folder actions after an export completes (Tauri desktop). */
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
