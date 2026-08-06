import { Octokit } from "@octokit/rest";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { summarizeRepoTreePaths, type RepoTreeSummary } from "./repo-tree-summary.js";

function safeRepoFilePath(repoDir: string, relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;
  const root = resolve(repoDir);
  const dest = resolve(root, normalized);
  if (dest !== root && !dest.startsWith(`${root}/`)) return null;
  return dest;
}

export type GithubRepoRef = {
  owner: string;
  repo: string;
  branch: string;
};

export function parseGithubUrl(url: string): GithubRepoRef | null {
  const trimmed = url.trim().replace(/\.git$/, "");
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/([^/]+))?$/i,
    /^git@github\.com:([^/]+)\/([^/.]+)/i,
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)/i,
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m) {
      return {
        owner: m[1],
        repo: m[2].replace(/\.git$/, ""),
        branch: m[3] ?? "main",
      };
    }
  }
  return null;
}

export async function listGithubBranches(
  url: string,
  token?: string | null,
): Promise<{ owner: string; repo: string; default_branch: string; branches: string[] }> {
  const ref = parseGithubUrl(url);
  if (!ref) throw new Error("Invalid GitHub repository URL");
  const octokit = new Octokit(token ? { auth: token } : {});
  const repoMeta = await octokit.repos.get({ owner: ref.owner, repo: ref.repo });
  const branches = await octokit.paginate(octokit.repos.listBranches, {
    owner: ref.owner,
    repo: ref.repo,
    per_page: 100,
  });
  return {
    owner: ref.owner,
    repo: ref.repo,
    default_branch: repoMeta.data.default_branch ?? ref.branch,
    branches: branches.map((b) => b.name),
  };
}

export async function listGithubTags(
  url: string,
  token?: string | null,
): Promise<{ owner: string; repo: string; tags: string[] }> {
  const ref = parseGithubUrl(url);
  if (!ref) throw new Error("Invalid GitHub repository URL");
  const octokit = new Octokit(token ? { auth: token } : {});
  const tags = await octokit.paginate(octokit.repos.listTags, {
    owner: ref.owner,
    repo: ref.repo,
    per_page: 100,
  });
  return {
    owner: ref.owner,
    repo: ref.repo,
    tags: tags.map((t) => t.name),
  };
}

export type SyncDocKind = "readme" | "md" | "pdf";

export type SyncDocEntry = {
  path: string;
  kind: SyncDocKind;
  sizeBytes: number;
};

export type SyncProgress = {
  phase: "stls" | "docs";
  current: number;
  total: number;
  path?: string;
  message?: string;
};

export type SyncResult = {
  commitSha: string | null;
  stlPaths: string[];
  downloaded: number;
  docPaths: SyncDocEntry[];
  docsDownloaded: number;
  docsSkippedBytes: number;
};

function classifyDocPath(path: string): SyncDocKind | null {
  const lower = path.toLowerCase();
  if (!lower.endsWith(".md") && !lower.endsWith(".pdf")) return null;
  if (lower.endsWith(".pdf")) return "pdf";
  const base = lower.split("/").pop() ?? lower;
  if (base === "readme.md" || base.startsWith("readme.")) return "readme";
  return "md";
}

/** Prefer streaming for large blobs; buffer small ones. */
const STREAM_THRESHOLD_BYTES = 2 * 1024 * 1024;

async function downloadRawFile(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  dest: string,
  token?: string | null,
  expectedSize?: number | null,
): Promise<{ ok: boolean; bytes: number }> {
  const segments = path.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${segments}`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return { ok: false, bytes: 0 };
  mkdirSync(dirname(dest), { recursive: true });

  const contentLength = Number(res.headers.get("content-length") ?? NaN);
  const sizeHint =
    (Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null) ??
    (expectedSize != null && expectedSize > 0 ? expectedSize : null);

  if (sizeHint != null && sizeHint >= STREAM_THRESHOLD_BYTES && res.body) {
    const nodeStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
    await pipeline(nodeStream, createWriteStream(dest));
    return { ok: true, bytes: sizeHint };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return { ok: true, bytes: buf.byteLength };
}

type RepoTreeEntry = {
  path: string;
  type: "blob" | "tree";
  size: number | null;
};

/** Resolve a ref to a commit and list the full recursive tree (no blob downloads). */
async function fetchGithubTreeEntries(
  octokit: Octokit,
  owner: string,
  repo: string,
  refName: string,
): Promise<{ commitSha: string; entries: RepoTreeEntry[]; truncated: boolean }> {
  // getCommit resolves any ref (branch, tag, or SHA), unlike getBranch which only accepts branches.
  const commitMeta = await octokit.repos.getCommit({ owner, repo, ref: refName });
  const commitSha = commitMeta.data.sha;
  const tree = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: commitSha,
    recursive: "true",
  });
  const entries: RepoTreeEntry[] = [];
  for (const item of tree.data.tree) {
    if (!item.path || (item.type !== "blob" && item.type !== "tree")) continue;
    entries.push({
      path: item.path,
      type: item.type,
      size: typeof item.size === "number" ? item.size : null,
    });
  }
  return { commitSha, entries, truncated: tree.data.truncated === true };
}

export type GithubRepoTreeSummary = {
  owner: string;
  repo: string;
  ref: string;
  commit_sha: string | null;
  summary: RepoTreeSummary;
};

/**
 * Pre-sync repo inspection: fetch the recursive tree listing only and summarize
 * top-level dirs, STL counts, and variant-looking subfolders. No blob downloads.
 */
export async function fetchGithubRepoTreeSummary(
  url: string,
  ref?: string | null,
  token?: string | null,
): Promise<GithubRepoTreeSummary> {
  const parsed = parseGithubUrl(url);
  if (!parsed) throw new Error("Invalid GitHub repository URL");
  const octokit = new Octokit(token ? { auth: token } : {});
  let refName = ref?.trim() || parsed.branch;
  let resolved: { commitSha: string; entries: RepoTreeEntry[]; truncated: boolean };
  try {
    resolved = await fetchGithubTreeEntries(octokit, parsed.owner, parsed.repo, refName);
  } catch (e) {
    // URLs without an explicit branch default to "main"; fall back to the repo default branch.
    if (refName !== "main" || (ref && ref.trim())) throw e;
    const repoMeta = await octokit.repos.get({ owner: parsed.owner, repo: parsed.repo });
    const defaultBranch = repoMeta.data.default_branch;
    if (!defaultBranch || defaultBranch === refName) throw e;
    refName = defaultBranch;
    resolved = await fetchGithubTreeEntries(octokit, parsed.owner, parsed.repo, refName);
  }
  const blobPaths = resolved.entries.filter((e) => e.type === "blob").map((e) => e.path);
  return {
    owner: parsed.owner,
    repo: parsed.repo,
    ref: refName,
    commit_sha: resolved.commitSha,
    summary: summarizeRepoTreePaths(blobPaths, { truncated: resolved.truncated }),
  };
}

export type SyncGithubOptions = {
  download?: boolean;
  maxDownloads?: number;
  tag?: string | null;
  /** Per-source docs budget (default 1 GiB). */
  maxDocsBytes?: number;
  onProgress?: (progress: SyncProgress) => void;
};

/** Fetch GitHub tree via Octokit; download STLs + markdown/PDF docs from raw.githubusercontent.com. */
export async function syncGithubSource(
  url: string,
  branch: string,
  repoDir: string,
  token?: string | null,
  options?: SyncGithubOptions,
): Promise<SyncResult> {
  const ref = parseGithubUrl(url);
  if (!ref) throw new Error("Invalid GitHub repository URL");
  const octokit = new Octokit(token ? { auth: token } : {});

  const tagName = options?.tag?.trim() || null;
  const refName = tagName || branch || ref.branch;
  const { commitSha, entries } = await fetchGithubTreeEntries(
    octokit,
    ref.owner,
    ref.repo,
    refName,
  );

  const stlBlobs = entries.filter(
    (item) => item.type === "blob" && item.path.toLowerCase().endsWith(".stl"),
  );

  const docBlobs = entries.filter(
    (item) => item.type === "blob" && classifyDocPath(item.path) != null,
  );

  const stlPaths = stlBlobs.map((b) => b.path).sort();
  const docEntries: SyncDocEntry[] = docBlobs
    .map((b) => {
      const path = b.path;
      const kind = classifyDocPath(path)!;
      return { path, kind, sizeBytes: b.size ?? 0 };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  let downloaded = 0;
  let docsDownloaded = 0;
  let docsSkippedBytes = 0;
  const shouldDownload = options?.download !== false;
  const maxDownloads = options?.maxDownloads ?? 500;
  const maxDocsBytes = options?.maxDocsBytes ?? 1024 * 1024 * 1024;

  mkdirSync(repoDir, { recursive: true });

  if (shouldDownload) {
    const stlSlice = stlPaths.slice(0, maxDownloads);
    for (let i = 0; i < stlSlice.length; i++) {
      const path = stlSlice[i]!;
      options?.onProgress?.({
        phase: "stls",
        current: i + 1,
        total: stlSlice.length,
        path,
        message: `Downloading STL ${i + 1}/${stlSlice.length}`,
      });
      const dest = safeRepoFilePath(repoDir, path);
      if (!dest) continue;
      const result = await downloadRawFile(ref.owner, ref.repo, refName, path, dest, token);
      if (result.ok) downloaded++;
    }

    let docsBudgetUsed = 0;
    const docsToFetch: SyncDocEntry[] = [];
    for (const entry of docEntries) {
      const size = entry.sizeBytes > 0 ? entry.sizeBytes : 0;
      // Always include PDFs even when size unknown; enforce total budget when size known.
      if (size > 0 && docsBudgetUsed + size > maxDocsBytes) {
        docsSkippedBytes += size;
        continue;
      }
      docsToFetch.push(entry);
      docsBudgetUsed += size;
    }

    for (let i = 0; i < docsToFetch.length; i++) {
      const entry = docsToFetch[i]!;
      options?.onProgress?.({
        phase: "docs",
        current: i + 1,
        total: docsToFetch.length,
        path: entry.path,
        message: `Downloading doc ${i + 1}/${docsToFetch.length}: ${entry.path}`,
      });
      const dest = safeRepoFilePath(repoDir, entry.path);
      if (!dest) continue;
      const result = await downloadRawFile(
        ref.owner,
        ref.repo,
        refName,
        entry.path,
        dest,
        token,
        entry.sizeBytes,
      );
      if (result.ok) {
        docsDownloaded++;
        if (result.bytes > 0) entry.sizeBytes = result.bytes;
      }
    }
  }

  return {
    commitSha,
    stlPaths,
    downloaded,
    docPaths: docEntries,
    docsDownloaded,
    docsSkippedBytes,
  };
}

export { classifyDocPath, safeRepoFilePath };
