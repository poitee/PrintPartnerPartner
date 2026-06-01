import type { DrizzleDb } from "./client.js";
import type { PostgresDrizzleDb } from "./client-postgres.js";

export type AppDrizzleDb = DrizzleDb | PostgresDrizzleDb;

function syncAwait<T>(promise: Promise<T>): T {
  const state = { done: false, value: undefined as T, error: undefined as unknown };
  promise
    .then((v) => {
      state.value = v;
      state.done = true;
    })
    .catch((e) => {
      state.error = e;
      state.done = true;
    });
  const wait = new Int32Array(new SharedArrayBuffer(4));
  while (!state.done) {
    Atomics.wait(wait, 0, 0, 50);
  }
  if (state.error) throw state.error;
  return state.value as T;
}

function wrapBuilder(builder: unknown): unknown {
  if (!builder || (typeof builder !== "object" && typeof builder !== "function")) {
    return builder;
  }
  const thenable =
    typeof (builder as { then?: unknown }).then === "function"
      ? (builder as Promise<unknown>)
      : null;

  return new Proxy(builder as object, {
    get(target, prop, receiver) {
      if (prop === "all") {
        return () => {
          const native = Reflect.get(target, "all", receiver);
          if (typeof native === "function") return native.call(target);
          if (thenable) return syncAwait(thenable as Promise<unknown[]>);
          throw new Error("Query builder is not awaitable");
        };
      }
      if (prop === "get") {
        return () => {
          const native = Reflect.get(target, "get", receiver);
          if (typeof native === "function") return native.call(target);
          if (thenable) {
            const rows = syncAwait(thenable as Promise<unknown[]>);
            return Array.isArray(rows) ? rows[0] : rows;
          }
          throw new Error("Query builder is not awaitable");
        };
      }
      if (prop === "run") {
        return () => {
          const native = Reflect.get(target, "run", receiver);
          if (typeof native === "function") return native.call(target);
          if (thenable) return syncAwait(thenable as Promise<unknown>);
          throw new Error("Query builder is not runnable");
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return (...args: unknown[]) => wrapBuilder(value.apply(target, args));
      }
      return value;
    },
  });
}

/** Expose sync Drizzle API (.all/.get/.run) for both SQLite and Postgres drivers. */
export function asSyncDb(db: AppDrizzleDb): DrizzleDb {
  if (!db || (typeof db !== "object" && typeof db !== "function")) {
    throw new Error("Database not connected");
  }
  try {
    const sample = (db as DrizzleDb).select();
    if (typeof (sample as { all?: unknown }).all === "function") {
      return db as DrizzleDb;
    }
  } catch {
    /* postgres — wrap below */
  }
  return new Proxy(db as object, {
    get(target, prop) {
      if (prop === "execute") {
        return (query: unknown) => {
          const execute = Reflect.get(target, prop) as (q: unknown) => unknown;
          return wrapBuilder(execute.call(target, query));
        };
      }
      const value = Reflect.get(target, prop);
      if (typeof value === "function") {
        return (...args: unknown[]) => wrapBuilder(value.apply(target, args));
      }
      return value;
    },
  }) as DrizzleDb;
}
