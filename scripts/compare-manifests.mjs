import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const [source, restored] = process.argv.slice(2);
if (!source || !restored)
  throw new Error("Supply source and restored manifest paths");
const left = JSON.parse(await readFile(source, "utf8"));
const right = JSON.parse(await readFile(restored, "utf8"));
assert.equal(left.version, 1);
assert.equal(right.version, 1);
assert.equal(
  left.schemaSha256,
  right.schemaSha256,
  "Restored database definitions differ",
);
assert.deepEqual(
  right.tables,
  left.tables,
  "Restored rows, counts, or exact values differ",
);
console.log(
  "Restore verified: all table contents and financial database definitions match.",
);
