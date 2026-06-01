/** Browser file-picker fallbacks when Tauri invoke is unavailable. */

function pickFileObject(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

export async function pickLocalDirectoryWeb(): Promise<string | null> {
  if (!("showDirectoryPicker" in window)) {
    const file = await pickFileObject("");
    return file?.name ?? null;
  }
  try {
    const handle = await (
      window as Window & {
        showDirectoryPicker?: () => Promise<{ name: string }>;
      }
    ).showDirectoryPicker?.();
    return handle?.name ?? null;
  } catch {
    return null;
  }
}

export async function pickKitBundleFileWeb(): Promise<File | null> {
  return pickFileObject(".zip,.kit,.json,application/zip");
}

export async function pickZipArchiveFileWeb(): Promise<File | null> {
  return pickFileObject(".zip,application/zip");
}

export async function saveTextFileWeb(
  defaultName: string,
  contents: string,
): Promise<string | null> {
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await (
        window as Window & {
          showSaveFilePicker?: (opts: {
            suggestedName: string;
          }) => Promise<{ name: string; createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
        }
      ).showSaveFilePicker?.({ suggestedName: defaultName });
      if (!handle) return null;
      const writable = await handle.createWritable();
      await writable.write(new Blob([contents], { type: "text/plain" }));
      await writable.close();
      return handle.name;
    } catch {
      return null;
    }
  }

  const blob = new Blob([contents], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = defaultName;
  anchor.click();
  URL.revokeObjectURL(url);
  return defaultName;
}
