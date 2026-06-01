/** Drizzle query helpers — sync (better-sqlite3) and async (postgres) drivers. */

export async function dbAll<T>(query: unknown): Promise<T[]> {
  const q = query as { all?: () => T[] };
  if (typeof q.all === "function") return q.all();
  return (await query) as T[];
}

export async function dbOne<T>(query: unknown): Promise<T | undefined> {
  const q = query as { get?: () => T };
  if (typeof q.get === "function") return q.get();
  const rows = await dbAll<T>(query);
  return rows[0];
}

export async function dbRun(query: unknown): Promise<void> {
  const q = query as { run?: () => void };
  if (typeof q.run === "function") {
    q.run();
    return;
  }
  await query;
}
