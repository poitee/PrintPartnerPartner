import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

test("public docs describe Builds, Sources, Plan, Checkoff, and Production", () => {
  const readme = read("README.md");
  const pages = read("docs/index.html");
  const pkg = JSON.parse(read("web/package.json"));

  assert.doesNotMatch(
    readme,
    /<code>Library<\/code> → <code>Plan<\/code> → <code>Parts<\/code> → <code>Progress<\/code> → <code>Export<\/code>/,
    "README still describes the retired Parts/Progress/Export pipeline",
  );
  assert.doesNotMatch(readme, /\|\s*\*\*Parts\*\*\s*\|/, "README still lists Parts as a workflow step");
  assert.doesNotMatch(readme, /\|\s*\*\*Progress\*\*\s*\|/, "README still lists Progress as a workflow step");
  assert.doesNotMatch(readme, /Create plan/, "README still tells users to Create plan");
  assert.match(readme, /Sources/);
  assert.match(readme, /Checkoff/);
  assert.match(readme, /Production/);
  assert.match(readme, /New Build/);
  assert.match(readme, /docs\/screenshots\/light\/progress\.png/);
  assert.match(readme, /docs\/screenshots\/light\/export\.png/);

  assert.match(pages, /pipeline-step">Builds</);
  assert.match(pages, /pipeline-step">Sources</);
  assert.match(pages, /pipeline-step">Plan</);
  assert.match(pages, /pipeline-step">Checkoff</);
  assert.match(pages, /pipeline-step">Production</);

  assert.doesNotMatch(
    pkg.description,
    /Library → Plan → Parts → Progress → Export/,
  );
  assert.match(pkg.description, /Builds/);
  assert.match(pkg.description, /Production/);

  const api = read("docs/API.md");
  assert.match(api, /not a complete contract for every operational route/);

  const capture = read("docs/scripts/capture-screenshots.mjs");
  assert.match(capture, /path: "\/library"/);
  assert.match(capture, /path: "\/builds"/);
  assert.match(capture, /path: "\/sources"/);
  assert.match(capture, /path: "\/plan"/);
  assert.match(capture, /path: "\/progress"/);
  assert.match(capture, /path: "\/export"/);

  const docsIndex = read("docs/README.md");
  assert.doesNotMatch(
    docsIndex,
    /\*\*Library\*\* → \*\*Plan\*\* → \*\*Parts\*\* → \*\*Progress\*\* → \*\*Export\*\*/,
    "docs/README still describes the retired Parts/Progress/Export pipeline",
  );
  assert.doesNotMatch(docsIndex, /Create plan/, "docs/README still tells users to Create plan");
  assert.doesNotMatch(docsIndex, /sidebar \*\*Plans\*\*/, "docs/README still points at a Plans page");
  assert.match(docsIndex, /Sources/);
  assert.match(docsIndex, /Checkoff/);
  assert.match(docsIndex, /Production/);
  assert.match(docsIndex, /New Build/);

  const playbook = read("docs/playbooks/kit-studio-build.md");
  assert.doesNotMatch(playbook, /Create plan/);
  assert.doesNotMatch(playbook, /\*\*Parts\*\* —/);
  assert.match(playbook, /New Build/);
  assert.match(playbook, /Production/);

  const kitAdvisor = read("docs/KIT_ADVISOR.md");
  assert.doesNotMatch(kitAdvisor, /Plan \/ Parts \/ Progress \/ Export/);
  assert.match(kitAdvisor, /Checkoff/);
  assert.doesNotMatch(docsIndex, /assistant-research-brief/);
  assert.doesNotMatch(docsIndex, /assistant-domain-ingest-schema/);

  const trackedPlans = spawnSync(
    "git",
    [
      "ls-files",
      "--",
      "docs/superpowers",
      ".superpowers",
      "docs/assistant-research-brief.md",
      "docs/assistant-domain-ingest-schema.md",
      "DATABASE_OPTIMIZATION.md",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(trackedPlans.status, 0);
  assert.equal(
    trackedPlans.stdout.trim(),
    "",
    "AI authoring briefs and internal plan trees must not be tracked in git",
  );
});
