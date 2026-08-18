import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

export type StagedPlate = {
  source: string;
  dest: string;
  filename: string;
};

function assertUnderRoot(root: string, candidate: string, label: string): string {
  const rootAbs = resolve(root) + sep;
  const candidateAbs = resolve(candidate);
  if (candidateAbs !== resolve(root) && !candidateAbs.startsWith(rootAbs)) {
    throw new Error(`${label} escapes allowed root: ${candidate}`);
  }
  return candidateAbs;
}

/**
 * Copy exported plate 3MFs into the shared slicer exchange inbox for one instance.
 * Does not move or rename object contents — filenames only.
 */
export function stagePlatesToExchange(opts: {
  exchangeRoot: string;
  instanceId: string;
  sourcePaths: string[];
  planSlug: string;
  exportsRoot?: string;
}): { staged: StagedPlate[]; inboxDir: string } {
  const exchangeRoot = resolve(opts.exchangeRoot);
  if (!opts.exchangeRoot.trim()) {
    throw new Error("exchange root is not configured (set PP_EXCHANGE_DIR)");
  }
  if (!existsSync(exchangeRoot)) {
    mkdirSync(exchangeRoot, { recursive: true });
  }

  const safeInstance = opts.instanceId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const safePlan = opts.planSlug.replace(/[^a-zA-Z0-9._-]+/g, "_") || "plan";
  const inboxDir = join(exchangeRoot, "pp-inbox", safeInstance, safePlan);
  mkdirSync(inboxDir, { recursive: true });
  assertUnderRoot(exchangeRoot, inboxDir, "inbox");

  const exportsRoot = opts.exportsRoot ? resolve(opts.exportsRoot) : null;
  const staged: StagedPlate[] = [];

  for (const source of opts.sourcePaths) {
    const sourceAbs = resolve(source);
    if (exportsRoot) {
      assertUnderRoot(exportsRoot, sourceAbs, "source");
    }
    if (!existsSync(sourceAbs)) {
      throw new Error(`Export plate missing: ${sourceAbs}`);
    }
    const filename = basename(sourceAbs);
    const dest = join(inboxDir, filename);
    assertUnderRoot(exchangeRoot, dest, "dest");
    copyFileSync(sourceAbs, dest);
    staged.push({ source: sourceAbs, dest, filename });
  }

  return { staged, inboxDir };
}

/** Honest browser-side local-open guidance (no silent desktop injection). */
export function localAppOpenHint(filename: string): {
  scheme_attempt: string | null;
  note: string;
} {
  return {
    scheme_attempt: null,
    note:
      `Browsers cannot reliably open “${filename}” in a desktop slicer. ` +
      "Download the 3MF and open it from the slicer’s File → Open (or drag onto the GUI).",
  };
}
