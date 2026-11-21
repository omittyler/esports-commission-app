/* eslint-disable @typescript-eslint/no-explicit-any */
// This is a deliberately bounded compatibility layer for this application's
// Prisma operations. Prisma D1 interactive transactions are NOT atomic. Writes
// are planned without touching D1, then committed using native D1.batch(), with
// a database version guard rejecting any stale read used by the plan.
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient, Prisma } from "./generated/client";
import type { PrismaClient as ApplicationClient } from "@prisma/client";
import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import metadata from "./model-metadata.json";

type Row = Record<string, any>;
type Field = {
  name: string;
  kind: string;
  type: string;
  isRequired: boolean;
  isId: boolean;
  isUnique: boolean;
  isList: boolean;
  hasDefaultValue: boolean;
  default?: unknown;
  isUpdatedAt?: boolean;
  relationName?: string;
  relationFromFields?: string[];
};
type Model = { name: string; uniqueFields: string[][]; fields: Field[] };
type Context = { binding: D1Database; reader: any };
const scope = new AsyncLocalStorage<Context>();
const models = new Map(
  (metadata as Model[]).map((m) => [
    m.name[0].toLowerCase() + m.name.slice(1),
    m,
  ]),
);
const reads = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);
const writes = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);
const quote = (name: string) => `"${name}"`;
export function databaseContext() {
  const ctx = scope.getStore();
  if (!ctx) throw new Error("Database operation outside a Worker request");
  return ctx;
}
export function withDatabase<T>(binding: D1Database, work: () => T): T {
  return scope.run(
    { binding, reader: new PrismaClient({ adapter: new PrismaD1(binding) }) },
    work,
  );
}
function known(code: string) {
  return new Prisma.PrismaClientKnownRequestError(
    "Database change conflicts with existing records",
    { code, clientVersion: "6.19.3" },
  );
}
function normalize(error: unknown): never {
  const message = String(error);
  if (message.includes("STALE_MUTATION")) throw known("P2034");
  if (message.includes("UNIQUE constraint failed")) throw known("P2002");
  if (error instanceof Prisma.PrismaClientKnownRequestError) throw error;
  // D1 errors can contain bound values. Never put them in a response or log.
  throw new Prisma.PrismaClientUnknownRequestError(
    "Database rejected the change; refresh and review the financial records",
    { clientVersion: "6.19.3" },
  );
}
function value(v: any, field: any) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) {
    if (!Number.isSafeInteger(v.getTime()))
      throw new Error("Invalid database date");
    return v.getTime();
  }
  if (typeof v === "bigint") {
    const n = Number(v);
    if (!Number.isSafeInteger(n))
      throw new Error("Amount exceeds D1's exact integer range");
    return n;
  }
  if (field.type === "Json") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" && !Number.isSafeInteger(v))
    throw new Error("Invalid database integer");
  if (!["number", "string"].includes(typeof v))
    throw new Error("Unsupported database value");
  return v;
}
function primitive(v: any) {
  return v instanceof Date ? v.getTime() : v;
}
async function read(
  ctx: Context,
  name: string,
  op: string,
  args: Row,
): Promise<any> {
  const large = Object.entries(args.where ?? {}).find(
    ([, filter]) =>
      filter &&
      typeof filter === "object" &&
      Array.isArray((filter as Row).in) &&
      (filter as Row).in.length > 80,
  );
  if (large) {
    if (
      !["findMany", "count"].includes(op) ||
      args.take !== undefined ||
      args.skip ||
      args.cursor ||
      args.distinct
    )
      throw new Error("Unsupported large D1 query");
    const [field, filter] = large as [string, Row],
      key = models.get(name)!.fields.find((f) => f.isId)!.name;
    const combined = new Map();
    for (let start = 0; start < filter.in.length; start += 80) {
      const rows: Row[] = await read(ctx, name, "findMany", {
        ...args,
        ...(op === "count" ? { select: { [key]: true } } : {}),
        where: {
          ...args.where,
          [field]: { ...filter, in: filter.in.slice(start, start + 80) },
        },
      });
      for (const row of rows) {
        if (row[key] === undefined)
          throw new Error("Large D1 queries must select their primary key");
        combined.set(row[key], row);
      }
    }
    if (op === "count") return combined.size;
    const rows = [...combined.values()];
    for (const spec of [
      ...(Array.isArray(args.orderBy)
        ? args.orderBy
        : args.orderBy
          ? [args.orderBy]
          : []),
    ].reverse())
      for (const [field, direction] of Object.entries(spec))
        rows.sort((a, b) =>
          primitive(a[field]) === primitive(b[field])
            ? 0
            : (primitive(a[field]) < primitive(b[field]) ? -1 : 1) *
              (direction === "desc" ? -1 : 1),
        );
    return rows;
  }
  return ctx.reader[name][op](args);
}
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, filter]) => {
    if (key === "AND")
      return (Array.isArray(filter) ? filter : [filter]).every((w) =>
        matches(row, w),
      );
    if (key === "OR") return filter.some((w: Row) => matches(row, w));
    if (key === "NOT")
      return !(Array.isArray(filter) ? filter : [filter]).some((w) =>
        matches(row, w),
      );
    if (!(key in row)) {
      // Named compound unique keys are an AND of scalar key values.
      if (
        filter &&
        typeof filter === "object" &&
        Object.keys(filter).every((k) => k in row)
      )
        return matches(row, filter);
      throw new Error("Unsupported staged relation filter");
    }
    const actual = primitive(row[key]);
    if (filter === null || typeof filter !== "object" || filter instanceof Date)
      return actual === primitive(filter);
    return Object.entries(filter).every(([op, operand]) => {
      const b = primitive(operand);
      if (op === "equals") return actual === b;
      if (op === "not") return !matches({ v: row[key] }, { v: operand });
      if (op === "in")
        return (operand as any[]).map(primitive).includes(actual);
      if (op === "notIn")
        return !(operand as any[]).map(primitive).includes(actual);
      if (actual === null || b === null) return false;
      if (op === "lt") return actual < b;
      if (op === "lte") return actual <= b;
      if (op === "gt") return actual > b;
      if (op === "gte") return actual >= b;
      throw new Error("Unsupported staged scalar filter");
    });
  });
}
type Change = {
  model: string;
  kind: "insert" | "update" | "delete";
  row: Row;
  previous?: Row;
};
class Plan {
  changes: Change[] = [];
  baseRows = new Map<string, Row[]>();
  startedAt = new Date();
  constructor(readonly ctx: Context) {}
  model(name: string) {
    const m = models.get(name);
    if (!m) throw new Error("Unknown database model");
    return m;
  }
  key(name: string) {
    return this.model(name).fields.find((f) => f.isId)!.name;
  }
  async read(name: string, op: string, args: Row = {}): Promise<any> {
    if (op === "aggregate" || op === "groupBy")
      return exactAggregate(this.ctx, name, op, args);
    const changed = this.changes.filter((c) => c.model === name);
    if (!changed.length) return read(this.ctx, name, op, args);
    // Staged reads must be scalar. Fail closed rather than returning relations
    // from an older snapshot, or silently issuing individual writes.
    if (args.distinct || args.cursor || args.skip)
      throw new Error("Unsupported staged query shape");
    const key = this.key(name);
    const rows: Row[] =
      this.baseRows.get(name) ?? (await this.ctx.reader[name].findMany());
    this.baseRows.set(name, rows);
    const overlay = new Map(rows.map((r) => [r[key], r]));
    for (const c of changed) {
      if (c.kind === "delete") overlay.delete(c.row[key]);
      else overlay.set(c.row[key], c.row);
    }
    let found = [...overlay.values()].filter((r) => matches(r, args.where));
    const order = args.orderBy
      ? Array.isArray(args.orderBy)
        ? args.orderBy
        : [args.orderBy]
      : [];
    found.sort((a, b) => {
      for (const spec of order)
        for (const [field, direction] of Object.entries(spec)) {
          const av = primitive(a[field]),
            bv = primitive(b[field]);
          if (av !== bv)
            return (av < bv ? -1 : 1) * (direction === "desc" ? -1 : 1);
        }
      return 0;
    });
    if (args.take !== undefined) found = found.slice(0, args.take);
    if (op === "count") return found.length;
    const project = async (r: Row) => {
      const output = args.select
        ? Object.fromEntries(
            Object.entries(args.select)
              .filter(([, on]) => on)
              .map(([k]) => [k, r[k]]),
          )
        : { ...r };
      for (const [key, spec] of Object.entries(
        args.include ?? args.select ?? {},
      )) {
        const relation = this.model(name).fields.find(
          (f) => f.name === key && f.kind === "object",
        );
        if (!relation || !spec) continue;
        const target = relation.type[0].toLowerCase() + relation.type.slice(1);
        const forward = relation.relationFromFields?.[0];
        const back = this.model(target).fields.find(
          (f) =>
            f.relationName === relation.relationName &&
            f.relationFromFields?.length,
        )?.relationFromFields?.[0];
        if (!forward && !back) throw new Error("Unsupported staged relation");
        const options: Row = typeof spec === "object" ? spec : {};
        output[key] =
          forward && r[forward] === null
            ? null
            : await this.read(
                target,
                relation.isList ? "findMany" : "findFirst",
                {
                  ...options,
                  where: {
                    AND: [
                      options.where ?? {},
                      {
                        [forward ? this.key(target) : back!]: forward
                          ? r[forward]
                          : r[this.key(name)],
                      },
                    ],
                  },
                },
              );
      }
      return output;
    };
    if (op === "findMany") return Promise.all(found.map(project));
    if (!found.length && op.endsWith("OrThrow")) throw known("P2025");
    return found.length ? project(found[0]) : null;
  }
  defaults(name: string, data: Row): Row {
    const model = this.model(name),
      row: Row = {};
    for (const f of model.fields.filter((f) => f.kind !== "object")) {
      let v = data[f.name];
      if (v === undefined && f.isUpdatedAt) v = new Date();
      if (v === undefined && f.hasDefaultValue) {
        const def = f.default as any;
        v =
          def?.name === "uuid"
            ? crypto.randomUUID()
            : def?.name === "now"
              ? new Date()
              : def;
        if (f.type === "Json" && typeof v === "string") v = JSON.parse(v);
      }
      if (v === undefined && !f.isRequired) v = null;
      if (v === undefined)
        throw new Error(`Missing database field ${model.name}.${f.name}`);
      value(v, f); // Reject unsafe integers before any write is submitted.
      row[f.name] = v;
    }
    return row;
  }
  async write(name: string, op: string, args: Row): Promise<any> {
    if (op === "create") {
      const model = this.model(name),
        row = this.defaults(name, args.data);
      const allowed = new Set(model.fields.map((f) => f.name));
      for (const field of Object.keys(args.data))
        if (!allowed.has(field)) throw new Error("Unsupported write field");
      this.changes.push({ model: name, kind: "insert", row });
      for (const f of model.fields.filter(
        (f) => f.kind === "object" && args.data[f.name] !== undefined,
      )) {
        const nested = args.data[f.name];
        if (!f.isList || Object.keys(nested).some((k) => k !== "create"))
          throw new Error("Unsupported nested write");
        const childName = f.type[0].toLowerCase() + f.type.slice(1);
        const back = this.model(childName).fields.find(
          (r) =>
            r.relationName === f.relationName && r.relationFromFields?.length,
        );
        if (!back || back.relationFromFields!.length !== 1)
          throw new Error("Unsupported nested relation");
        for (const child of Array.isArray(nested.create)
          ? nested.create
          : [nested.create])
          await this.write(childName, "create", {
            data: {
              ...child,
              [back.relationFromFields![0]]: row[this.key(name)],
            },
          });
      }
      if (args.include || args.select)
        throw new Error("Unsupported write projection");
      return { ...row };
    }
    if (op === "createMany") {
      let count = 0;
      for (const data of Array.isArray(args.data) ? args.data : [args.data]) {
        if (args.skipDuplicates) {
          const m = this.model(name);
          const keys = [
            ...m.fields
              .filter((f) => f.isId || f.isUnique)
              .map((f) => [f.name]),
            ...m.uniqueFields,
          ];
          const candidates = keys.filter((k) =>
            k.every((f) => data[f] !== undefined && data[f] !== null),
          );
          if (!this.baseRows.has(name))
            this.baseRows.set(name, await this.ctx.reader[name].findMany());
          const rows = [
            ...this.baseRows.get(name)!,
            ...this.changes
              .filter((c) => c.model === name && c.kind === "insert")
              .map((c) => c.row),
          ];
          if (
            candidates.some((keys) =>
              rows.some((r) =>
                keys.every((k) => primitive(r[k]) === primitive(data[k])),
              ),
            )
          )
            continue;
        }
        await this.write(name, "create", { data });
        count++;
      }
      return { count };
    }
    if (op === "upsert") {
      const existing = await this.read(name, "findUnique", {
        where: args.where,
      });
      return this.write(
        name,
        existing ? "update" : "create",
        existing
          ? { where: args.where, data: args.update }
          : { data: args.create },
      );
    }
    if (["update", "updateMany", "delete", "deleteMany"].includes(op)) {
      const many = op.endsWith("Many"),
        deleting = op.startsWith("delete");
      const rows = many
        ? await this.read(name, "findMany", { where: args.where })
        : [await this.read(name, "findUniqueOrThrow", { where: args.where })];
      for (const before of rows) {
        const after = { ...before };
        if (!deleting) {
          for (const [k, v] of Object.entries(args.data)) {
            if (v === undefined) continue;
            const f = this.model(name).fields.find(
              (f) => f.name === k && f.kind !== "object",
            );
            if (!f) throw new Error("Unsupported update field");
            // Shopify's session adapter includes the unchanged ID in upserts.
            // Permit that shape while keeping primary keys immutable.
            if (f.isId) {
              if (primitive(v) !== primitive(before[k])) throw new Error("Primary keys cannot change");
              continue;
            }
            after[k] =
              v &&
              typeof v === "object" &&
              !(v instanceof Date) &&
              f.type !== "Json"
                ? Object.keys(v).length === 1 && "increment" in v
                  ? before[k] + (v as Row).increment
                  : (() => {
                      throw new Error("Unsupported update operation");
                    })()
                : v;
          }
          for (const f of this.model(name).fields.filter((f) => f.isUpdatedAt))
            after[f.name] = new Date();
        }
        this.changes.push({
          model: name,
          kind: deleting ? "delete" : "update",
          row: after,
          previous: before,
        });
      }
      return many
        ? { count: rows.length }
        : { ...rows[0], ...this.changes[this.changes.length - 1].row };
    }
    throw new Error("Unsupported database mutation");
  }
  proxy(): any {
    return new Proxy(
      {},
      {
        get: (_, name: string) => {
          if (name === "$queryRaw")
            return (strings: TemplateStringsArray) => {
              const sql = strings.join("?");
              if (
                /^SELECT (id FROM "Organization"|shop FROM "OrderSyncState") WHERE .* FOR UPDATE$/.test(
                  sql,
                )
              )
                return Promise.resolve([]);
              if (
                sql ===
                "SELECT date_trunc('milliseconds', clock_timestamp()) AS now"
              )
                return Promise.resolve([{ now: this.startedAt }]);
              throw new Error("Unsupported transactional SQL");
            };
          if (!models.has(name))
            throw new Error("Unsupported transaction operation");
          return new Proxy(
            {},
            {
              get:
                (_, op: string) =>
                (args: Row = {}) =>
                  reads.has(op)
                    ? this.read(name, op, args)
                    : this.write(name, op, args),
            },
          );
        },
      },
    );
  }
  statements(): D1PreparedStatement[] {
    const result: D1PreparedStatement[] = [];
    // Reorder insert-only spans by FK dependency so an order with many lines
    // uses a handful of JSON inserts, not two D1 queries per line. Updates and
    // deletes are barriers; historical closes keep their original position.
    const rank = [
      "organization",
      "affiliateAccount",
      "commissionProgram",
      "programVersion",
      "commissionRate",
      "productAssignment",
      "order",
      "orderLine",
      "commissionTransaction",
      "commissionPayment",
      "paymentAllocation",
      "paymentVoid",
      "auditEvent",
    ];
    for (let start = 0; start < this.changes.length;) {
      if (this.changes[start].kind !== "insert") {
        start++;
        continue;
      }
      let end = start + 1;
      while (end < this.changes.length && this.changes[end].kind === "insert")
        end++;
      this.changes.splice(
        start,
        end - start,
        ...this.changes
          .slice(start, end)
          .sort((a, b) => rank.indexOf(a.model) - rank.indexOf(b.model)),
      );
      start = end;
    }
    for (let i = 0; i < this.changes.length;) {
      const change = this.changes[i],
        model = this.model(change.model);
      const table =
        change.model === "commissionPayment"
          ? "CommissionPaymentDraft"
          : model.name;
      const fields = model.fields.filter((f) => f.kind !== "object");
      if (change.kind === "insert") {
        const rows = [];
        do {
          const c = this.changes[i++];
          rows.push(fields.map((f) => value(c.row[f.name], f)));
        } while (
          i < this.changes.length &&
          this.changes[i].model === change.model &&
          this.changes[i].kind === "insert"
        );
        // json_each uses one binding for any size collection. Values are data,
        // never SQL text. All amounts have already passed safe integer checks.
        result.push(
          this.ctx.binding
            .prepare(
              `INSERT INTO ${quote(table)} (${fields.map((f) => quote(f.name)).join(",")}) SELECT ${fields.map((_, n) => `json_extract(value,'$[${n}]')`).join(",")} FROM json_each(?)`,
            )
            .bind(JSON.stringify(rows)),
        );
      } else {
        const key = this.key(change.model);
        if (change.kind === "delete")
          result.push(
            this.ctx.binding
              .prepare(`DELETE FROM ${quote(table)} WHERE ${quote(key)}=?`)
              .bind(change.row[key]),
          );
        else {
          const updated = fields.filter(
            (f) =>
              f.name !== key &&
              primitive(change.row[f.name]) !==
                primitive(change.previous![f.name]),
          );
          if (updated.length)
            result.push(
              this.ctx.binding
                .prepare(
                  `UPDATE ${quote(table)} SET ${updated.map((f) => `${quote(f.name)}=?`).join(",")} WHERE ${quote(key)}=?`,
                )
                .bind(
                  ...updated.map((f) => value(change.row[f.name], f)),
                  change.row[key],
                ),
            );
        }
        i++;
      }
    }
    // Only sealed payments are visible to Prisma/reporting. The seal trigger
    // checks the whole signed allocation set before this batch can commit.
    for (const c of this.changes.filter(
      (c) => c.model === "commissionPayment" && c.kind === "insert",
    ))
      result.push(
        this.ctx.binding
          .prepare('INSERT INTO "PaymentSeal" ("paymentId") VALUES (?)')
          .bind(c.row.id),
      );
    return result;
  }
}
async function version(ctx: Context) {
  return (await ctx.binding
    .prepare('SELECT version FROM "MutationVersion" WHERE id=1')
    .first<{ version: number }>())!.version;
}
async function mutate(ctx: Context, work: (tx: any) => Promise<any>) {
  for (let attempt = 0; ; attempt++) {
    const expected = await version(ctx),
      plan = new Plan(ctx);
    const result = await work(plan.proxy());
    if (!plan.changes.length) {
      if (expected === (await version(ctx))) return result;
      if (attempt < 3) continue;
      throw known("P2034");
    }
    try {
      await ctx.binding.batch([
        ctx.binding
          .prepare(
            'UPDATE "MutationGuard" SET "expectedVersion"=?, "startedAt"=? WHERE id=1',
          )
          .bind(expected, plan.startedAt.getTime()),
        ...plan.statements(),
      ]);
      return result;
    } catch (error) {
      if (String(error).includes("STALE_MUTATION") && attempt < 3) continue;
      normalize(error);
    }
  }
}
async function exactAggregate(
  ctx: Context,
  name: string,
  op: string,
  args: Row,
) {
  if (args.having || args._avg || args._min || args._max || args._count)
    throw new Error("Unsupported exact aggregate");
  const fields = Object.keys(args._sum ?? {}),
    by: string[] = args.by ?? [];
  const rows: Row[] = await ctx.reader[name].findMany({
    where: args.where,
    select: Object.fromEntries([...fields, ...by].map((k) => [k, true])),
  });
  const groups = new Map<string, Row>();
  for (const r of rows) {
    const key = JSON.stringify(by.map((k) => r[k]));
    const group = groups.get(key) ?? {
      ...Object.fromEntries(by.map((k) => [k, r[k]])),
      _sum: Object.fromEntries(fields.map((k) => [k, null])),
    };
    for (const f of fields)
      if (r[f] !== null) group._sum[f] = (group._sum[f] ?? 0n) + BigInt(r[f]);
    groups.set(key, group);
  }
  return op === "groupBy"
    ? [...groups.values()]
    : (groups.values().next().value ?? {
        _sum: Object.fromEntries(fields.map((f) => [f, null])),
      });
}
function task(run: () => Promise<any>, kind: "read" | "write" = "read") {
  let promise: Promise<any> | undefined;
  return {
    then: (yes: any, no: any) => (promise ??= run()).then(yes, no),
    run,
    kind,
  };
}
async function raw(strings: TemplateStringsArray, ...args: any[]) {
  const ctx = databaseContext(),
    sql = strings.join("?");
  if (sql === "SELECT 1") return ctx.binding.prepare(sql).all();
  if (
    sql.startsWith(
      'UPDATE "WebhookDelivery" SET "claimedAt"=clock_timestamp()',
    ) &&
    args.length === 2
  ) {
    // Single SQLite statement provides an atomic lease, including concurrent
    // cron/webhook invocations. PostgreSQL SKIP LOCKED is unnecessary on D1.
    const now = Date.now();
    return (
      await ctx.binding
        .prepare(
          'UPDATE "WebhookDelivery" SET "claimedAt"=?, "claimToken"=?, attempts=attempts+1 WHERE id=(SELECT id FROM "WebhookDelivery" WHERE "processedAt" IS NULL AND "nextAttemptAt"<=? AND ("claimedAt" IS NULL OR "claimedAt"<?) AND shop=? ORDER BY "receivedAt",id LIMIT 1) RETURNING id,shop,"resourceGid"',
        )
        .bind(now, args[0], now, now - 600000, args[1])
        .all()
    ).results;
  }
  throw new Error("Unsupported Worker SQL");
}
const database = new Proxy(
  {},
  {
    get: (_, name: string) => {
      if (name === "$queryRaw") return raw;
      if (name === "$disconnect") return async () => {};
      if (name === "$transaction")
        return async (work: any) => {
          const ctx = databaseContext();
          if (typeof work === "function") return mutate(ctx, work);
          if (
            !Array.isArray(work) ||
            work.some((t) => !t.run || t.kind !== "read")
          )
            throw new Error(
              "Only lazy read operations are allowed in report transactions",
            );
          for (let attempt = 0; attempt < 4; attempt++) {
            const before = await version(ctx),
              result = await Promise.all(work.map((t: any) => t.run()));
            if (before === (await version(ctx))) return result;
          }
          throw known("P2034");
        };
      if (!models.has(name)) throw new Error("Unsupported database operation");
      return new Proxy(
        {},
        {
          get:
            (_, op: string) =>
            (args: Row = {}) => {
              if (reads.has(op))
                return task(() =>
                  op === "aggregate" || op === "groupBy"
                    ? exactAggregate(databaseContext(), name, op, args)
                    : read(databaseContext(), name, op, args),
                );
              if (writes.has(op))
                return task(
                  () => mutate(databaseContext(), (tx) => tx[name][op](args)),
                  "write",
                );
              throw new Error("Unsupported database delegate operation");
            },
        },
      );
    },
  },
) as ApplicationClient;
export default database;
