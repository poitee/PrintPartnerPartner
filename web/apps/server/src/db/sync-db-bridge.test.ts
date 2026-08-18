import { describe, expect, it } from "vitest";
import {
  asSyncDb,
  registerPostgresSyncQuery,
  runSerializedSettingsMutation,
  type AppDrizzleDb,
} from "./sync-db-bridge.js";

describe("runSerializedSettingsMutation", () => {
  it("runs the callback and returns its value without Promise/syncAwait", () => {
    expect(runSerializedSettingsMutation(() => 42)).toBe(42);
  });

  it("allows nested calls on the same stack", () => {
    const result = runSerializedSettingsMutation(() =>
      runSerializedSettingsMutation(() => "nested"),
    );
    expect(result).toBe("nested");
  });

  it("releases the lock so a later call can run", () => {
    runSerializedSettingsMutation(() => "first");
    expect(runSerializedSettingsMutation(() => "second")).toBe("second");
  });
});

describe("asSyncDb", () => {
  it("executes Postgres builders through a synchronous query bridge", () => {
    const builder = {
      toSQL: () => ({ sql: "select $1::text as value", params: ["ready"] }),
      then: () => undefined,
    };
    const postgres = {
      select: () => builder,
    } as unknown as AppDrizzleDb;
    registerPostgresSyncQuery(postgres, ({ sql, params }) => {
      expect(sql).toBe("select $1::text as value");
      expect(params).toEqual(["ready"]);
      return { rows: [{ value: "ready" }], rowCount: 1 };
    });

    const query = asSyncDb(postgres).select() as unknown as {
      all: () => Array<{ value: string }>;
    };
    expect(query.all()).toEqual([{ value: "ready" }]);
  });
});
