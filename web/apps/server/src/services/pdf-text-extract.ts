import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { PDFParse } from "pdf-parse";

export const DOCS_TEXT_DIR = ".docs-text";

/** Pages per chunk written for assistant retrieval. */
export const PDF_CHUNK_PAGES = 5;

/** Files at or above this size extract in a background job (per-page). */
export const PDF_BG_EXTRACT_BYTES = 8 * 1024 * 1024;

export type PdfExtractStatus = "pending" | "ready" | "error" | "skipped" | "na";

export type PdfPageChunk = {
  pageStart: number;
  pageEnd: number;
  text: string;
};

export type PdfExtractResult = {
  status: PdfExtractStatus;
  hash: string;
  pageCount: number;
  text: string;
  chunks: PdfPageChunk[];
  cachePath: string | null;
  error?: string;
};

function safeUnderRoot(root: string, relative: string): string | null {
  const normalized = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;
  const absRoot = resolve(root);
  const dest = resolve(absRoot, normalized);
  if (dest !== absRoot && !dest.startsWith(`${absRoot}/`)) return null;
  return dest;
}

export function contentHashForFile(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex").slice(0, 24);
}

export function docsTextDir(repoRoot: string): string {
  return join(repoRoot, DOCS_TEXT_DIR);
}

export function sidecarPathForHash(repoRoot: string, hash: string): string {
  return join(docsTextDir(repoRoot), `${hash}.txt`);
}

export function chunkSidecarPath(repoRoot: string, hash: string): string {
  return join(docsTextDir(repoRoot), `${hash}.chunks.json`);
}

function writeSidecar(
  repoRoot: string,
  hash: string,
  text: string,
  chunks: PdfPageChunk[],
): string {
  const dir = docsTextDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const path = sidecarPathForHash(repoRoot, hash);
  writeFileSync(path, text, "utf8");
  writeFileSync(chunkSidecarPath(repoRoot, hash), JSON.stringify(chunks), "utf8");
  return path;
}

function readCachedChunks(repoRoot: string, hash: string): PdfPageChunk[] | null {
  const path = chunkSidecarPath(repoRoot, hash);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(raw)) return null;
    return raw as PdfPageChunk[];
  } catch {
    return null;
  }
}

function pagesToChunks(
  pages: Array<{ text?: string; num?: number }>,
): { text: string; chunks: PdfPageChunk[]; pageCount: number } {
  const pageCount = pages.length;
  const chunks: PdfPageChunk[] = [];
  const allParts: string[] = [];
  for (let i = 0; i < pages.length; i += PDF_CHUNK_PAGES) {
    const slice = pages.slice(i, i + PDF_CHUNK_PAGES);
    const pageStart = i + 1;
    const pageEnd = i + slice.length;
    const text = slice
      .map((p, idx) => {
        const body = String(p.text ?? "").trim();
        return body ? `--- page ${pageStart + idx} ---\n${body}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
    if (text) {
      chunks.push({ pageStart, pageEnd, text });
      allParts.push(text);
    }
  }
  return { text: allParts.join("\n\n"), chunks, pageCount };
}

export type ExtractPdfOptions = {
  /** Force re-extract even if sidecar exists. */
  force?: boolean;
  /** Optional progress callback (page-oriented). */
  onProgress?: (current: number, total: number) => void;
  /**
   * When true, extract page-by-page (better for large manuals).
   * Default: auto when file >= PDF_BG_EXTRACT_BYTES.
   */
  perPage?: boolean;
};

/**
 * Extract text from a PDF under `repoRoot`, caching under `.docs-text/{hash}.txt`.
 * `relativePath` is relative to the repo root.
 */
export async function extractPdfText(
  repoRoot: string,
  relativePath: string,
  options: ExtractPdfOptions = {},
): Promise<PdfExtractResult> {
  const abs = safeUnderRoot(repoRoot, relativePath);
  if (!abs || !existsSync(abs)) {
    return {
      status: "error",
      hash: "",
      pageCount: 0,
      text: "",
      chunks: [],
      cachePath: null,
      error: "PDF not found",
    };
  }

  let hash: string;
  try {
    hash = contentHashForFile(abs);
  } catch (e) {
    return {
      status: "error",
      hash: "",
      pageCount: 0,
      text: "",
      chunks: [],
      cachePath: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const cachePath = sidecarPathForHash(repoRoot, hash);
  if (!options.force && existsSync(cachePath)) {
    const text = readFileSync(cachePath, "utf8");
    const chunks = readCachedChunks(repoRoot, hash) ?? [
      { pageStart: 1, pageEnd: 1, text },
    ];
    return {
      status: "ready",
      hash,
      pageCount: chunks[chunks.length - 1]?.pageEnd ?? 0,
      text,
      chunks,
      cachePath,
    };
  }

  const size = statSync(abs).size;
  const perPage = options.perPage ?? size >= PDF_BG_EXTRACT_BYTES;

  try {
    const data = new Uint8Array(readFileSync(abs));
    const parser = new PDFParse({ data });

    if (perPage) {
      const info = await parser.getInfo();
      const total = Math.max(1, Number(info.total) || 1);
      const pages: Array<{ text: string; num: number }> = [];
      for (let page = 1; page <= total; page++) {
        options.onProgress?.(page, total);
        const part = await parser.getText({ partial: [page] });
        const pageText =
          part.pages?.map((p) => String(p.text ?? "")).join("\n") ??
          String(part.text ?? "");
        pages.push({ text: pageText, num: page });
      }
      await parser.destroy().catch(() => undefined);
      const assembled = pagesToChunks(pages);
      const written = writeSidecar(repoRoot, hash, assembled.text, assembled.chunks);
      return {
        status: "ready",
        hash,
        pageCount: assembled.pageCount,
        text: assembled.text,
        chunks: assembled.chunks,
        cachePath: written,
      };
    }

    options.onProgress?.(1, 1);
    const result = await parser.getText();
    await parser.destroy().catch(() => undefined);
    const pages = (result.pages ?? []).map((p, i) => ({
      text: String(p.text ?? ""),
      num: i + 1,
    }));
    if (pages.length === 0 && result.text) {
      pages.push({ text: String(result.text), num: 1 });
    }
    const assembled = pagesToChunks(pages);
    const written = writeSidecar(repoRoot, hash, assembled.text, assembled.chunks);
    return {
      status: "ready",
      hash,
      pageCount: assembled.pageCount,
      text: assembled.text,
      chunks: assembled.chunks,
      cachePath: written,
    };
  } catch (e) {
    return {
      status: "error",
      hash,
      pageCount: 0,
      text: "",
      chunks: [],
      cachePath: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Read cached extracted text if present (no re-parse). */
export function readCachedPdfText(
  repoRoot: string,
  relativePath: string,
): { text: string; chunks: PdfPageChunk[]; hash: string } | null {
  const abs = safeUnderRoot(repoRoot, relativePath);
  if (!abs || !existsSync(abs)) return null;
  try {
    const hash = contentHashForFile(abs);
    const cache = sidecarPathForHash(repoRoot, hash);
    if (!existsSync(cache)) return null;
    const text = readFileSync(cache, "utf8");
    const chunks = readCachedChunks(repoRoot, hash) ?? [
      { pageStart: 1, pageEnd: 1, text },
    ];
    return { text, chunks, hash };
  } catch {
    return null;
  }
}

export function docTitleFromPath(path: string): string {
  const base = basename(path);
  if (/^readme\.md$/i.test(base)) return "README";
  return base;
}

export { dirname };
