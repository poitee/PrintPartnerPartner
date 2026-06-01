import { describe, expect, it } from "vitest";
import { parentDirectory, profileExportDir, safePlanSlug } from "./exportPaths";

describe("exportPaths", () => {
  it("slugifies plan names", () => {
    expect(safePlanSlug("My Kit Name")).toBe("My_Kit_Name");
    expect(safePlanSlug("   ")).toBe("export");
  });

  it("builds nested export directories", () => {
    expect(profileExportDir("/home/.print-partner/exports", "Voron 2.4", "3mf")).toBe(
      "/home/.print-partner/exports/Voron_2.4/3mf",
    );
    expect(profileExportDir("/tmp/exports", "Plan", "checklist")).toBe(
      "/tmp/exports/Plan/checklist",
    );
    expect(profileExportDir("/tmp/exports", "Plan", "stl-missing")).toBe(
      "/tmp/exports/Plan/stl-missing",
    );
  });

  it("returns parent directory for files", () => {
    expect(parentDirectory("/tmp/exports/Plan/3mf/plate_01.3mf")).toBe(
      "/tmp/exports/Plan/3mf",
    );
    expect(parentDirectory("C:\\exports\\a.html")).toBe("C:/exports");
  });
});
