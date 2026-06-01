import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("defaults to self-host deploy mode", () => {
    const prev = process.env.DEPLOY_MODE;
    delete process.env.DEPLOY_MODE;
    const config = loadConfig();
    expect(config.deployMode).toBe("self-host");
    if (prev !== undefined) process.env.DEPLOY_MODE = prev;
  });
});
