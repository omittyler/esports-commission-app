import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
const input = process.argv[2];
if (!input?.startsWith("backups/d1-source-") || !input.endsWith(".json"))
  throw new Error("Choose a private backups/d1-source-*.json export");
const snapshot = JSON.parse(readFileSync(input, "utf8"));
if (
  snapshot.format !== 1 ||
  createHash("sha256").update(JSON.stringify(snapshot.tables)).digest("hex") !==
    snapshot.sha256
)
  throw new Error("Source snapshot checksum mismatch");
const models = JSON.parse(
  readFileSync("cloudflare/model-metadata.json", "utf8"),
);
const quote = (s) => `"${s}"`;
const literal = (v) =>
  v === null
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replaceAll("'", "''")}'`;
const physical = (model) =>
  model === "CommissionPayment" ? "CommissionPaymentDraft" : model;
function values(model, row) {
  return model.fields
    .filter((f) => f.kind !== "object")
    .map((field) => {
      const v = row[field.name];
      if (v === null) return null;
      if (v === undefined)
        throw new Error(`Missing source field ${model.name}.${field.name}`);
      if (field.type === "DateTime") {
        const ms = new Date(v).getTime();
        if (!Number.isSafeInteger(ms))
          throw new Error("Invalid source timestamp");
        return ms;
      }
      if (field.type === "BigInt") {
        const n = BigInt(v);
        if (n < -9007199254740991n || n > 9007199254740991n)
          throw new Error(
            "Source contains an amount outside D1 exact range; migration stopped",
          );
        return Number(n);
      }
      if (field.type === "Boolean") return v ? 1 : 0;
      if (field.type === "Json") return JSON.stringify(v);
      return v;
    });
}
const validation = new DatabaseSync(":memory:");
validation.exec(readFileSync("cloudflare/migrations/0001_portal.sql", "utf8"));
const sql = [
  'CREATE TABLE "MigrationManifest" (id INTEGER PRIMARY KEY CHECK(id=1), "sourceHash" TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0);',
  `INSERT INTO "MigrationManifest" (id,"sourceHash") VALUES(1,${literal(snapshot.sha256)});`,
  // Enforce a new empty target, without deleting or overwriting any row.
  'CREATE TABLE "MigrationEmptyCheck" (n INTEGER CHECK(n=0));',
  'INSERT INTO "MigrationEmptyCheck" SELECT (SELECT count(*) FROM "Organization")+(SELECT count(*) FROM "Order")+(SELECT count(*) FROM "Session");',
];
validation.exec(sql.join("\n"));
function execute(statement) {
  validation.exec(statement);
  sql.push(statement);
}
function insert(name, row) {
  const model = models.find((m) => m.name === name),
    fields = model.fields.filter((f) => f.kind !== "object");
  execute(
    `INSERT INTO ${quote(physical(name))} (${fields.map((f) => quote(f.name)).join(",")}) VALUES (${values(model, row).map(literal).join(",")});`,
  );
}
const baseOrder = [
  "Organization",
  "AffiliateAccount",
  "CommissionProgram",
  "ProgramVersion",
  "CommissionRate",
  "ProductAssignment",
  "Order",
  "OrderLine",
  "AuditEvent",
  "Session",
  "WebhookDelivery",
  "OrderSyncState",
];
for (const name of baseOrder)
  for (const original of snapshot.tables[name] ?? []) {
    const row = { ...original };
    // Leases are operational state belonging to the old worker, never money.
    if (name === "WebhookDelivery" || name === "OrderSyncState") {
      row.claimToken = null;
      row.claimedAt = null;
    }
    if (name === "OrderSyncState") {
      row.forceFull = true;
      row.nextScanAt = new Date().toISOString();
    }
    insert(name, row);
  }
// Replay posting order through the SAME guards used by the application. A
// historic paid refund must be applied after its payment, preserving credits.
const events = [
  ...(snapshot.tables.CommissionTransaction ?? []).map((row) => ({
    name: "CommissionTransaction",
    row,
  })),
  ...(snapshot.tables.CommissionPayment ?? []).map((row) => ({
    name: "CommissionPayment",
    row,
  })),
  ...(snapshot.tables.PaymentVoid ?? []).map((row) => ({
    name: "PaymentVoid",
    row,
  })),
].sort(
  (a, b) =>
    a.row.createdAt.localeCompare(b.row.createdAt) ||
    (a.name === "CommissionTransaction" && a.row.type === "sale" ? -1 : 1),
);
for (const { name, row } of events) {
  if (name === "CommissionPayment") {
    const account = snapshot.tables.AffiliateAccount.find(
      (a) => a.organizationId === row.organizationId,
    );
    if (!account?.verifiedAt || !account.authSubject)
      throw new Error(
        "Payment history has no verified owner; migration requires review",
      );
    // The payee/approval snapshot was checked when posted. Temporarily present
    // it during offline replay, then restore the exact current profile.
    execute(
      `UPDATE "AffiliateAccount" SET status='approved',"paypalEmail"=${literal(row.payeeEmail)} WHERE id=${literal(account.id)};`,
    );
    insert(name, row);
    for (const allocation of snapshot.tables.PaymentAllocation.filter(
      (a) => a.paymentId === row.id,
    ))
      insert("PaymentAllocation", allocation);
    execute(`INSERT INTO "PaymentSeal" VALUES(${literal(row.id)});`);
    execute(
      `UPDATE "AffiliateAccount" SET status=${literal(account.status)},"paypalEmail"=${literal(account.paypalEmail)} WHERE id=${literal(account.id)};`,
    );
  } else insert(name, row);
}
if (validation.prepare("PRAGMA foreign_key_check").all().length)
  throw new Error("Foreign key validation failed");
// Compare every persisted scalar, including IDs, source keys, rates, contacts,
// tokens, audit entries and financial timestamps; print only counts/checksum.
const counts = {};
for (const model of models) {
  if (model.name === "RateLimitBucket") continue;
  const fields = model.fields.filter((f) => f.kind !== "object");
  const key = model.fields.find((f) => f.isId).name;
  const actual = validation
    .prepare(
      `SELECT ${fields.map((f) => quote(f.name)).join(",")} FROM ${quote(physical(model.name))} ORDER BY ${quote(key)}`,
    )
    .all();
  const expected = [...snapshot.tables[model.name]].sort((a, b) =>
    String(a[key]).localeCompare(String(b[key])),
  );
  if (actual.length !== expected.length)
    throw new Error(`Migration row count mismatch: ${model.name}`);
  for (let i = 0; i < actual.length; i++) {
    const target = Object.fromEntries(
      fields.map((f, n) => [f.name, values(model, expected[i])[n]]),
    );
    for (const f of fields) {
      if (
        ["WebhookDelivery", "OrderSyncState"].includes(model.name) &&
        ["claimToken", "claimedAt", "forceFull", "nextScanAt"].includes(f.name)
      )
        continue;
      if (actual[i][f.name] !== target[f.name])
        throw new Error(`Migration scalar mismatch: ${model.name}.${f.name}`);
    }
  }
  counts[model.name] = actual.length;
}
execute('UPDATE "MigrationManifest" SET completed=1 WHERE id=1;');
const output = input.replace(/\.json$/, ".sql");
writeFileSync(output, sql.join("\n") + "\n", { flag: "wx", mode: 0o600 });
validation.close();
console.log(
  JSON.stringify({
    path: output,
    sourceHash: snapshot.sha256,
    counts,
    validated: true,
  }),
);
