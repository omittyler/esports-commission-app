import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

// Hash raw PostgreSQL JSON text: bigint values never pass through JSON.parse.
function digest(rows: { row: string }[]) {
  const hash = createHash("sha256");
  for (const item of rows) hash.update(item.row).update("\n");
  return hash.digest("hex");
}
function identifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
const output = process.argv[2];
if (!output) throw new Error("Supply a private output path for the manifest");
const target = new URL(process.env.DATABASE_URL ?? "");
if (process.argv[3]) {
  if (!/^[a-z][a-z0-9_]+$/.test(process.argv[3]))
    throw new Error("Invalid database name");
  target.pathname = `/${process.argv[3]}`;
}
const db = new PrismaClient({
  datasources: { db: { url: target.toString() } },
});
try {
  const manifest = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
      const tables = await tx.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename COLLATE "C"`;
      const contents: Record<string, { count: number; sha256: string }> = {};
      for (const table of tables) {
        const rows = await tx.$queryRawUnsafe<{ row: string }[]>(
          `SELECT row_to_json(t)::text AS row FROM public.${identifier(table.tablename)} t ORDER BY (row_to_json(t)::text) COLLATE "C"`,
        );
        contents[table.tablename] = {
          count: rows.length,
          sha256: digest(rows),
        };
      }
      const schema = await tx.$queryRaw<{ row: string }[]>`
      SELECT row_to_json(s)::text AS row FROM (
        SELECT 'column' AS kind, c.relname||'.'||a.attname AS name,
          format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||a.attidentity||':'||a.attgenerated||':'||COALESCE(pg_get_expr(d.adbin,d.adrelid),'') AS definition
          FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
          WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
        UNION ALL
        SELECT 'constraint', c.relname||'.'||k.conname, pg_get_constraintdef(k.oid,true)
          FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
        UNION ALL
        SELECT 'trigger', c.relname||'.'||t.tgname, pg_get_triggerdef(t.oid,true)||':'||t.tgenabled
          FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
        UNION ALL
        SELECT 'index', tablename||'.'||indexname, indexdef FROM pg_indexes WHERE schemaname='public'
        UNION ALL
        SELECT 'function', p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', pg_get_functiondef(p.oid)
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
          AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid='pg_proc'::regclass AND dep.objid=p.oid AND dep.deptype='e')
        UNION ALL
        SELECT 'enum', t.typname||'.'||e.enumsortorder::text, e.enumlabel
          FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'
      ) s ORDER BY (row_to_json(s)::text) COLLATE "C"`;
      return { version: 1, tables: contents, schemaSha256: digest(schema) };
    },
    { isolationLevel: "RepeatableRead", timeout: 120000 },
  );
  await writeFile(output, JSON.stringify(manifest, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(
    `Manifest saved: ${Object.keys(manifest.tables).length} tables; private values omitted.`,
  );
} finally {
  await db.$disconnect();
}
