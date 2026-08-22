import process from "node:process";

const fetchFn = globalThis.fetch;
const HeadersCtor = globalThis.Headers;
const FormDataCtor = globalThis.FormData;
const BlobCtor = globalThis.Blob;

/** Tiny two-facet STL so naming, Checkoff, and Production have real units. */
export const FIXTURE_STL = `solid cube
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 20 0 0
      vertex 0 20 0
    endloop
  endfacet
  facet normal 0 0 -1
    outer loop
      vertex 0 0 0
      vertex 0 20 0
      vertex 20 0 0
    endloop
  endfacet
endsolid cube
`;

export const FIXTURE_BUILD_NAME = "Fixture Build";
export const FIXTURE_SOURCE_NAME = "Fixture Kit";
export const FIXTURE_PRINTER_NAME = "Shop Bed";

async function json(apiOrigin, path, init = {}) {
  const headers = new HeadersCtor(init.headers);
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetchFn(`${apiOrigin}${path}`, {
    cache: "no-store",
    ...init,
    headers,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed: ${response.status} ${text.slice(0, 300)}`);
  }
  if (!text) return null;
  return JSON.parse(text);
}

/**
 * Seed a local Source, accepted Build, and unbound Printer against a live API.
 */
export async function seedWorkflowFixture(apiOrigin) {
  const source = await json(apiOrigin, "/sources", {
    method: "POST",
    body: JSON.stringify({ name: FIXTURE_SOURCE_NAME, source_kind: "local" }),
  });

  const form = new FormDataCtor();
  const stl = new BlobCtor([FIXTURE_STL], { type: "model/stl" });
  form.append("files", stl, "cube.stl");
  form.append("files", stl, "lid.stl");
  form.append("relative_paths", JSON.stringify(["body/cube.stl", "lid/lid.stl"]));
  const uploaded = await fetchFn(`${apiOrigin}/sources/${source.id}/upload-files`, {
    method: "POST",
    cache: "no-store",
    body: form,
  });
  if (!uploaded.ok) {
    throw new Error(`upload-files failed: ${uploaded.status} ${(await uploaded.text()).slice(0, 300)}`);
  }
  const uploadedBody = await uploaded.json();
  if ((uploadedBody.stl_count ?? 0) < 2) {
    throw new Error(`expected two STLs, got ${JSON.stringify(uploadedBody)}`);
  }

  const plan = await json(apiOrigin, "/plans", {
    method: "POST",
    body: JSON.stringify({ name: FIXTURE_BUILD_NAME }),
  });
  await json(apiOrigin, `/plans/${plan.id}/layers/base`, {
    method: "PUT",
    body: JSON.stringify({ project_id: source.id }),
  });

  const draft = await json(apiOrigin, `/plans/${plan.id}/drafts/recompute`, {
    method: "POST",
    headers: { "Idempotency-Key": `fixture-recompute-${process.pid}` },
    body: JSON.stringify({ apply_manifest: true }),
  });
  if (draft?.reconciliation?.kind !== "ready") {
    throw new Error(`draft recompute was ${draft?.reconciliation?.kind ?? "missing"}, expected ready`);
  }
  await json(apiOrigin, `/plans/${plan.id}/drafts/${draft.draft.draft_id}/apply`, {
    method: "POST",
    headers: { "Idempotency-Key": `fixture-apply-${process.pid}` },
    body: JSON.stringify({
      expected_snapshot_digest: draft.draft.snapshot_digest,
      expected_lifecycle_version: draft.draft.lifecycle_version,
      expected_base: draft.draft.base,
    }),
  });

  const printer = await json(apiOrigin, "/printers", {
    method: "POST",
    body: JSON.stringify({ name: FIXTURE_PRINTER_NAME, preset_id: "preset-voron-250" }),
  });

  const parts = await json(apiOrigin, `/plans/${plan.id}/parts?limit=100`);
  const rows = Array.isArray(parts?.parts) ? parts.parts : [];
  const filenames = rows.map((row) => String(row.filename ?? "")).filter(Boolean);
  if (filenames.length < 2) {
    throw new Error(`fixture apply produced ${filenames.length} parts: ${JSON.stringify(filenames)}`);
  }
  if (!filenames.some((name) => name.includes("cube.stl"))) {
    throw new Error(`expected cube.stl in parts, got ${JSON.stringify(filenames)}`);
  }
  if (!filenames.some((name) => name.includes("lid.stl"))) {
    throw new Error(`expected lid.stl in parts, got ${JSON.stringify(filenames)}`);
  }

  return {
    sourceId: source.id,
    planId: plan.id,
    printerId: printer.id,
    printerName: printer.name,
    partCount: filenames.length,
    filenames,
  };
}
