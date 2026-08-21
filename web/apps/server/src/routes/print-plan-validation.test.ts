import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AppRepository } from "../db/repository.js";
import { registerPrintPlanRoutes } from "./print-plan.js";

describe("print-plan HTTP validation", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function fixture(initialPlan: Record<string, unknown>) {
    const settings = new Map<string, string>([
      ["print_plan:7", JSON.stringify(initialPlan)],
    ]);
    const repo = {
      getOwnedProfileIdentity: (id: number) =>
        id === 7 ? { id, name: "Plan", archivedAt: null } : null,
      getProfile: () => {
        throw new Error("summary Progress must not be read");
      },
      getSetting: (key: string) => settings.get(key) ?? null,
      setSetting: (key: string, value: string) => {
        settings.set(key, value);
      },
    } as unknown as AppRepository;
    const app = Fastify();
    apps.push(app);
    await registerPrintPlanRoutes(app, { repo });
    return { app, settings };
  }

  it("returns 400 and leaves the saved plan unchanged for malformed input", async () => {
    const initial = {
      enabled_printer_ids: ["voron"],
      plate_layout: null,
      group_assignments: {},
      grouping_strategy: "height_band",
    };
    const { app, settings } = await fixture(initial);
    const before = settings.get("print_plan:7");

    const response = await app.inject({
      method: "PUT",
      url: "/plans/7/print-plan",
      payload: {
        enabled_printer_ids: ["voron", 7],
        grouping_strategy: "location",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      detail: "Invalid kit print plan: enabled_printer_ids",
    });
    expect(settings.get("print_plan:7")).toBe(before);
  });

  it("returns 400 for a non-object body instead of surfacing a server error", async () => {
    const { app } = await fixture({
      enabled_printer_ids: [],
      plate_layout: null,
      group_assignments: {},
      grouping_strategy: "location",
    });

    const response = await app.inject({
      method: "PUT",
      url: "/plans/7/print-plan",
      headers: { "content-type": "application/json" },
      payload: "null",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().detail).toMatch(/print plan body/i);
  });

  it("returns the persisted grouping strategy from GET", async () => {
    const { app } = await fixture({
      enabled_printer_ids: ["voron"],
      plate_layout: null,
      group_assignments: {},
      grouping_strategy: "height_band",
    });

    const response = await app.inject({
      method: "GET",
      url: "/plans/7/print-plan",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().plan.grouping_strategy).toBe("height_band");
  });

  it("preserves the ownership-only 404 without reading summary Progress", async () => {
    const { app } = await fixture({
      enabled_printer_ids: [],
      plate_layout: null,
      group_assignments: {},
      grouping_strategy: "location",
    });

    const response = await app.inject({ method: "GET", url: "/plans/999/print-plan" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ detail: "Profile not found" });
  });
});
