import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const input = process.argv[2],
  location = process.argv[3];
if (
  !input?.startsWith("backups/d1-source-") ||
  !input.endsWith(".json") ||
  !["--local", "--remote", "--verify-remote", "--verify-local"].includes(
    location,
  )
)
  throw new Error(
    "Usage: node scripts/import-d1.mjs backups/d1-source-*.json --local|--remote|--verify-remote|--verify-local",
  );
const snapshot = JSON.parse(readFileSync(input, "utf8"));
if (
  createHash("sha256").update(JSON.stringify(snapshot.tables)).digest("hex") !==
  snapshot.sha256
)
  throw new Error("Source checksum mismatch");
const models = JSON.parse(
  readFileSync("cloudflare/model-metadata.json", "utf8"),
).filter((m) => m.name !== "RateLimitBucket");
const quote = (s) => `"${s}"`;
function cli(args) {
  try {
    const output = execFileSync(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "d1",
        "execute",
        "crafted-commissions",
        location.includes("remote") ? "--remote" : "--local",
        "--json",
        ...args,
      ],
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024, stdio: "pipe" },
    );
    // Remote file imports can emit progress before their JSON result. Verify
    // success using a separate read instead of parsing that progress stream.
    return args.includes("--file") ? null : JSON.parse(output);
  } catch (error) {
    writeFileSync(
      ".cache/d1-import-error.private.log",
      `${error.stdout ?? ""}\n${error.stderr ?? ""}`,
      { mode: 0o600 },
    );
    throw new Error(
      "D1 operation failed. Details saved privately; no rows or credentials were printed.",
    );
  }
}
try {
  if (!location.startsWith("--verify"))
    cli(["--file", input.replace(/\.json$/, ".sql"), "--yes"]);
  const results = cli([
    "--command",
    models
      .map(
        (m) =>
          `SELECT * FROM ${quote(m.name)} ORDER BY ${quote(m.fields.find((f) => f.isId).name)}`,
      )
      .join(";") +
      ';SELECT * FROM "MigrationManifest" WHERE id=1;PRAGMA foreign_key_check;',
  ]);
  for (let i = 0; i < models.length; i++) {
    const model = models[i],
      rows = results[i].results,
      fields = model.fields.filter((f) => f.kind !== "object");
    const key = fields.find((f) => f.isId).name;
    const expected = new Map(
      snapshot.tables[model.name].map((r) => [r[key], r]),
    );
    if (rows.length !== expected.size)
      throw new Error(`Row count mismatch: ${model.name}`);
    for (const row of rows) {
      const source = expected.get(row[key]);
      if (!source) throw new Error(`Unexpected row: ${model.name}`);
      for (const field of fields) {
        if (
          ["WebhookDelivery", "OrderSyncState"].includes(model.name) &&
          ["claimToken", "claimedAt", "forceFull", "nextScanAt"].includes(
            field.name,
          )
        )
          continue;
        let value = source[field.name];
        if (value !== null) {
          if (field.type === "DateTime") value = new Date(value).getTime();
          if (field.type === "BigInt") {
            const n = BigInt(value);
            if (n < -9007199254740991n || n > 9007199254740991n)
              throw new Error("Unsafe source amount");
            value = Number(n);
          }
          if (field.type === "Boolean") value = value ? 1 : 0;
          if (field.type === "Json") value = JSON.stringify(value);
        }
        if (row[field.name] !== value)
          throw new Error(`Scalar mismatch: ${model.name}.${field.name}`);
      }
    }
  }
  const manifest = results[models.length].results[0];
  if (
    manifest.sourceHash !== snapshot.sha256 ||
    manifest.completed !== 1 ||
    results[models.length + 1].results.length
  )
    throw new Error("Migration manifest or foreign keys failed verification");
  console.log(
    JSON.stringify({
      location,
      verified: true,
      sourceHash: snapshot.sha256,
      counts: Object.fromEntries(
        models.map((m, i) => [m.name, results[i].results.length]),
      ),
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
