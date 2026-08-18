import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readPage = (name: string) =>
  readFileSync(new URL(`./${name}.tsx`, import.meta.url), "utf8");

const build = readPage("BuildPage");
const plans = readPage("PlansPage");
const settings = readPage("SettingsPage");
const exportPage = readPage("ExportPage");

describe("engine-dependent page states", () => {
  it("surfaces profile-list failures on Plan and Plans", () => {
    for (const source of [build, plans]) {
      expect(source).toContain("profilesError");
      expect(source).toMatch(/Could not load plans?/);
    }
  });

  it("shows explicit engine state in Plan and Settings", () => {
    for (const source of [build, settings]) {
      expect(source).toContain("engineError");
      expect(source).toContain("Engine offline");
      expect(source).toContain("Connecting to the engine");
    }
  });

  it("keeps Settings engine mutations disabled while offline", () => {
    expect(settings).toContain("const engineReady = Boolean(health?.ok)");
    expect(settings).toMatch(/disabled=\{!engineReady[^}]*\}[\s\S]*?Add filament/);
    expect(settings).toMatch(/disabled=\{!engineReady[^}]*\}[\s\S]*?Save token/);
  });

  it("does not render the Export send panel without a selected plan", () => {
    expect(exportPage).toMatch(
      /selectedProfileId == null[\s\S]*?Open a plan to send[\s\S]*?:\s*\([\s\S]*?<PrinterSendPanel/,
    );
  });
});
