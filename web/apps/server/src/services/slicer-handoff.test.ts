import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { localAppOpenHint, stagePlatesToExchange } from "./slicer-handoff.js";

describe("stagePlatesToExchange", () => {
  it("copies plates into pp-inbox/<instance>/<plan>", () => {
    const root = mkdtempSync(join(tmpdir(), "pp-handoff-"));
    try {
      const exportsRoot = join(root, "exports");
      const exchangeRoot = join(root, "exchange");
      mkdirSync(exportsRoot, { recursive: true });
      const plate = join(exportsRoot, "plate_01.3mf");
      writeFileSync(plate, "3mf-bytes");

      const { staged, inboxDir } = stagePlatesToExchange({
        exchangeRoot,
        instanceId: "slicer-orca",
        planSlug: "My Kit",
        sourcePaths: [plate],
        exportsRoot,
      });

      expect(inboxDir).toContain(join("pp-inbox", "slicer-orca"));
      expect(staged).toHaveLength(1);
      expect(readFileSync(staged[0]!.dest, "utf8")).toBe("3mf-bytes");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects sources outside exports root", () => {
    const root = mkdtempSync(join(tmpdir(), "pp-handoff-escape-"));
    try {
      const exportsRoot = join(root, "exports");
      const exchangeRoot = join(root, "exchange");
      mkdirSync(exportsRoot, { recursive: true });
      const outside = join(root, "evil.3mf");
      writeFileSync(outside, "nope");
      expect(() =>
        stagePlatesToExchange({
          exchangeRoot,
          instanceId: "slicer-1",
          planSlug: "plan",
          sourcePaths: [outside],
          exportsRoot,
        }),
      ).toThrow(/escapes/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("localAppOpenHint", () => {
  it("explains download fallback", () => {
    const hint = localAppOpenHint("plate.3mf");
    expect(hint.scheme_attempt).toBeNull();
    expect(hint.note).toMatch(/Download/i);
  });
});
