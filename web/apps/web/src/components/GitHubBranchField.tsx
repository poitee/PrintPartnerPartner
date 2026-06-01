import { useEffect, useRef, useState } from "react";
import { fetchGithubBranches } from "../api/engine";

const GITHUB_REPO_RE =
  /^(?:https?:\/\/(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?|git@github\.com:[\w.-]+\/[\w.-]+(?:\.git)?|[\w.-]+\/[\w.-]+(?:\.git)?)$/i;

type Props = {
  url: string;
  branch: string;
  onBranchChange: (branch: string) => void;
};

export default function GitHubBranchField({ url, branch, onBranchChange }: Props) {
  const [branches, setBranches] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = url.trim();
    if (!GITHUB_REPO_RE.test(trimmed)) {
      setBranches(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(true);
    setError(null);

    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      void (async () => {
        try {
          const result = await fetchGithubBranches(trimmed);
          if (requestId !== requestIdRef.current) return;
          setBranches(result.branches);
          setManual(false);
          setError(null);
          if (!branch.trim() || !result.branches.includes(branch)) {
            onBranchChange(result.default_branch);
          }
        } catch (e) {
          if (requestId !== requestIdRef.current) return;
          setBranches(null);
          setManual(true);
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          if (requestId === requestIdRef.current) setLoading(false);
        }
      })();
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps -- branch changes should not re-fetch

  const showDropdown = branches != null && branches.length > 0 && !manual;

  return (
    <label className="flex flex-col gap-1 text-sm">
      Branch
      {showDropdown ? (
        <select
          className="rounded-md border border-border bg-background px-3 py-2"
          value={branch}
          onChange={(e) => onBranchChange(e.target.value)}
          disabled={loading}
        >
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="rounded-md border border-border bg-background px-3 py-2"
          value={branch}
          onChange={(e) => onBranchChange(e.target.value)}
          placeholder={loading ? "Loading branches…" : "main"}
          disabled={loading}
        />
      )}
      {loading && <span className="text-xs text-muted-foreground">Loading branches…</span>}
      {error && (
        <span className="text-xs text-muted-foreground">
          {error} Enter branch manually.
        </span>
      )}
      {showDropdown && (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground underline hover:text-foreground"
          onClick={() => setManual(true)}
        >
          Enter branch manually
        </button>
      )}
    </label>
  );
}
