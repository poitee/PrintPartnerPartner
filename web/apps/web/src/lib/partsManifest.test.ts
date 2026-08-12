import { describe, expect, it } from "vitest";
import {
  buildPartsManifestRows,
  parseManifestCsv,
  PARTS_MANIFEST_HEADERS,
  rowsToCsv,
  type PartsManifestRow,
} from "./partsManifest";
import { parsePartsManifestXlsx, partsManifestToXlsxBlob } from "./partsManifestXlsx";
import type { PlanReview } from "../api/engine";
import type { SourceSummary } from "@print-partner/contracts";

function sampleReview(): PlanReview {
  return {
    profile_id: 1,
    plan_name: "Voron Test",
    layers: [
      {
        id: 10,
        layer_type: "base",
        project_id: 5,
        project_name: "Voron2",
        local_path: "/tmp/v",
        synced: true,
        last_synced_at: null,
      },
    ],
    totals: {
      included_parts: 1,
      total_print_units: 2,
      by_role: {},
      by_filament: {},
    },
    issues: [],
    has_blockers: false,
    part_groups: [
      {
        folder: "frame",
        source_layer: "base:Voron2",
        parts: [
          {
            id: 42,
            match_key: "frame/x_extrusion.stl",
            relative_path: "frame/x_extrusion.stl",
            filename: "x_extrusion.stl",
            source_layer: "base:Voron2",
            status: "ok",
            role: "structural",
            requirement: null,
            option_group_id: null,
            included: true,
            filament_color_id: null,
            quantity_auto: 2,
            quantity_override: null,
            quantity_effective: 2,
            printed_count: 1,
            print_units: [true, false],
            missing: false,
            filament_display: "ABS Black",
          },
        ],
      },
    ],
  };
}

const sampleSources: SourceSummary[] = [
  {
    id: 5,
    name: "Voron2",
    url: "https://github.com/VoronDesign/Voron-2",
    source_kind: "github",
    source_type: "git",
    role: "base",
    category: null,
    branch: "main",
    tag: null,
    local_path: "/tmp/v",
    last_synced_at: null,
    last_commit_sha: null,
    docs_url: null,
    manifest_community_slug: null,
    metadata: null,
  },
];

describe("partsManifest CSV", () => {
  it("uses the stable header row", () => {
    const rows = buildPartsManifestRows({ review: sampleReview(), sources: sampleSources });
    const csv = rowsToCsv(rows);
    expect(csv.split(/\r?\n/)[0]).toBe(PARTS_MANIFEST_HEADERS.join(","));
    expect(rows[0]!.source_link).toBe("https://github.com/VoronDesign/Voron-2");
    expect(rows[0]!.file_name).toBe("x_extrusion.stl");
    expect(rows[0]!.quantity).toBe("2");
    expect(rows[0]!.printed_count).toBe("1");
  });

  it("round-trips CSV parse", () => {
    const rows = buildPartsManifestRows({ review: sampleReview(), sources: sampleSources });
    const parsed = parseManifestCsv(rowsToCsv(rows));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.match_key).toBe("frame/x_extrusion.stl");
    expect(parsed.rows[0]!.part_id).toBe("42");
  });

  it("accepts header aliases", () => {
    const csv = "filename,qty,url\npart.stl,3,https://example.com\n";
    const parsed = parseManifestCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]!.file_name).toBe("part.stl");
    expect(parsed.rows[0]!.quantity).toBe("3");
    expect(parsed.rows[0]!.source_link).toBe("https://example.com");
  });
});

describe("partsManifest XLSX", () => {
  it("round-trips via JSZip workbook", async () => {
    const rows = buildPartsManifestRows({ review: sampleReview(), sources: sampleSources });
    const blob = await partsManifestToXlsxBlob(rows);
    const buf = await blob.arrayBuffer();
    const parsed = await parsePartsManifestXlsx(buf);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]!.file_name).toBe("x_extrusion.stl");
    expect(parsed.rows[0]!.quantity).toBe("2");
  });

  it("preserves empty optional columns as strings", () => {
    const empty = Object.fromEntries(PARTS_MANIFEST_HEADERS.map((h) => [h, ""])) as PartsManifestRow;
    empty.file_name = "a.stl";
    empty.quantity = "1";
    expect(empty.notes).toBe("");
  });
});
