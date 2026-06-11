import { useEffect, useState } from "react";
import {
  fetchManifestWarnings,
  reportManifestIssue,
  type ManifestWarning,
} from "../api/engine";

type Props = {
  profileId: number | null;
  profileName?: string;
  open: boolean;
  onClose: () => void;
};

export default function ReportIssueDialog({
  profileId,
  profileName,
  open,
  onClose,
}: Props) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [warnings, setWarnings] = useState<ManifestWarning[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open || profileId == null) return;
    setTitle(profileName ? `Manifest problem: ${profileName}` : "");
    setDetails("");
    setResult(null);
    setError(null);
    void fetchManifestWarnings(profileId)
      .then(setWarnings)
      .catch(() => setWarnings([]));
  }, [open, profileId, profileName]);

  if (!open) return null;

  // Only open server-provided issue links that point at GitHub (open-redirect guard).
  const openGithubUrl = (url: string): boolean => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
      return false;
    }
    window.open(parsed.toString(), "_blank", "noopener,noreferrer");
    return true;
  };

  const onSubmit = async () => {
    if (profileId == null) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await reportManifestIssue({
        profile_id: profileId,
        title: title.trim() || undefined,
        details: details.trim() || undefined,
      });
      if (response.created && response.issue_url) {
        setResult(`Issue created: ${response.issue_url}`);
        openGithubUrl(response.issue_url);
      } else if (response.prefilled_url) {
        if (openGithubUrl(response.prefilled_url)) {
          setResult("Opened GitHub with a prefilled issue form.");
        } else {
          setError("Received an unexpected issue link; not opening it.");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog card"
        role="dialog"
        aria-labelledby="report-issue-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="report-issue-title">Report manifest problem</h3>
        <p className="muted">
          Creates a GitHub issue when a PAT is configured in Settings; otherwise opens a
          prefilled issue form in your browser.
        </p>
        {warnings.length > 0 && (
          <ul className="warning-list compact">
            {warnings.slice(0, 5).map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
            {warnings.length > 5 && (
              <li className="muted">…and {warnings.length - 5} more warnings</li>
            )}
          </ul>
        )}
        <label>
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Details
          <textarea
            rows={5}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            disabled={busy}
            placeholder="What went wrong? Include expected vs actual behavior."
          />
        </label>
        {error && <p className="status-err">{error}</p>}
        {result && <p className="result">{result}</p>}
        <div className="toolbar-row">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void onSubmit()}
            disabled={profileId == null || busy}
          >
            {busy ? "Submitting…" : "Submit report"}
          </button>
        </div>
      </div>
    </div>
  );
}
