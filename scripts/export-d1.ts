/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import metadata from "../cloudflare/model-metadata.json";
const db = new PrismaClient();
try {
  const tables = await db.$transaction(
    async (tx) => {
      const result: Record<string, any[]> = {};
      for (const model of metadata) {
        if (model.name === "RateLimitBucket") continue;
        const delegate = model.name[0].toLowerCase() + model.name.slice(1);
        const key = model.fields.find((f) => f.isId)!.name;
        result[model.name] = await (tx as any)[delegate].findMany({
          orderBy: { [key]: "asc" },
        });
      }
      return result;
    },
    { isolationLevel: "RepeatableRead", timeout: 60000 },
  );
  const content = JSON.stringify(tables, (_, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  const sha256 = createHash("sha256").update(content).digest("hex");
  const target = `backups/d1-source-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.json`;
  await mkdir("backups", { recursive: true });
  await writeFile(
    target,
    JSON.stringify(
      {
        format: 1,
        exportedAt: new Date().toISOString(),
        sha256,
        tables: JSON.parse(content),
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      path: target,
      sha256,
      counts: Object.fromEntries(
        Object.entries(tables).map(([name, rows]) => [name, rows.length]),
      ),
    }),
  );
} catch {
  console.error(
    "Source export failed. Check the local PostgreSQL service and DATABASE_URL; no credentials or private rows were printed.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
