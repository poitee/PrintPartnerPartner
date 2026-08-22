import assert from "node:assert/strict";
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
});
