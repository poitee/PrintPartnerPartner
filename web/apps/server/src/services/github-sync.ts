import { Octokit } from "@octokit/rest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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

export type SyncResult = {
  commitSha: string | null;
  stlPaths: string[];
  downloaded: number;
};

async function downloadStlRaw(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  dest: string,
  token?: string | null,
): Promise<boolean> {
  const segments = path.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${segments}`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return true;
}

/** Fetch GitHub tree via Octokit; download STLs from raw.githubusercontent.com. */
export async function syncGithubSource(
  url: string,
  branch: string,
  repoDir: string,
  token?: string | null,
  options?: { download?: boolean; maxDownloads?: number },
): Promise<SyncResult> {
  const ref = parseGithubUrl(url);
  if (!ref) throw new Error("Invalid GitHub repository URL");
  const octokit = new Octokit(token ? { auth: token } : {});

  const branchName = branch || ref.branch;
  const branchMeta = await octokit.repos.getBranch({
    owner: ref.owner,
    repo: ref.repo,
    branch: branchName,
  });
  const commitSha = branchMeta.data.commit.sha;

  const tree = await octokit.git.getTree({
    owner: ref.owner,
    repo: ref.repo,
    tree_sha: commitSha,
    recursive: "true",
  });

  const stlBlobs = tree.data.tree.filter(
    (item) => item.type === "blob" && item.path?.toLowerCase().endsWith(".stl"),
  );

  const stlPaths = stlBlobs.map((b) => b.path!).sort();
  let downloaded = 0;
  const shouldDownload = options?.download !== false;
  const maxDownloads = options?.maxDownloads ?? 500;

  mkdirSync(repoDir, { recursive: true });

  if (shouldDownload) {
    for (const path of stlPaths.slice(0, maxDownloads)) {
      const dest = safeRepoFilePath(repoDir, path);
      if (!dest) continue;
      const ok = await downloadStlRaw(ref.owner, ref.repo, branchName, path, dest, token);
      if (ok) downloaded++;
    }
  }

  return { commitSha, stlPaths, downloaded };
}
