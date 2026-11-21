/* eslint-disable @typescript-eslint/no-explicit-any */
// Fast tests of the actual migration SQL and adapter, including native SQLite
// rollback. The separate workerd check verifies the same operations on D1.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { D1Database } from "@cloudflare/workers-types";
export function sqliteBinding() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("cloudflare/migrations/0001_portal.sql", "utf8"));
  let queries = 0;
  let tail = Promise.resolve();
  const prepare = (sql: string, values: any[] = []): any => ({
    bind: (...args: any[]) => prepare(sql, args),
    all: async () => {
      queries++;
      const statement = sqlite.prepare(sql);
      const results = statement.all(...values);
      const meta = sqlite.prepare("SELECT changes() AS changes").get()!;
      return { results, success: true, meta };
    },
    first: async (column?: string) => {
      const row = (await prepare(sql, values).all()).results[0] ?? null;
      return column && row ? row[column] : row;
    },
    run: async () => prepare(sql, values).all(),
    raw: async (options?: { columnNames: boolean }) => {
      queries++;
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      const rows = statement.all(...values);
      return options?.columnNames
        ? [statement.columns().map((c) => c.name), ...rows]
        : rows;
    },
  });
  const binding = {
    prepare,
    batch: async (statements: any[]) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      } finally {
        release();
      }
    },
  } as unknown as D1Database;
  return {
    binding,
    sqlite,
    close: () => sqlite.close(),
    queries: () => queries,
  };
}
