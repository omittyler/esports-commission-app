import { readFile, writeFile, mkdir } from "node:fs/promises";
const models = JSON.parse(
  await readFile(
    new URL("../cloudflare/model-metadata.json", import.meta.url),
    "utf8",
  ),
);
let sql = await readFile(
  new URL("../.cache/d1-base.sql", import.meta.url),
  "utf8",
);
// Prisma reads the sealed view; only the batch writer inserts draft headers.
sql = sql.replaceAll('"CommissionPayment"', '"CommissionPaymentDraft"');
const add = (s) => {
  sql += `\n${s}\n`;
};
const check = (condition, message) =>
  `SELECT CASE WHEN (${condition}) IS NOT 1 THEN RAISE(ABORT,'${message}') END;`;
const guard = (table, event, body, suffix = "guard") =>
  add(
    `CREATE TRIGGER "${table}_${event}_${suffix}" BEFORE ${event} ON "${table}" BEGIN\n${body}\nEND;`,
  );
const immutable = (table) => {
  for (const op of ["UPDATE", "DELETE"])
    guard(
      table,
      op,
      "SELECT RAISE(ABORT,'Append-only financial history');",
      "immutable",
    );
};
const currency = (v) => `${v} GLOB '[A-Z][A-Z][A-Z]' AND length(${v})=3`;
const period = `NEW."effectiveTo" IS NULL OR NEW."effectiveTo">NEW."effectiveFrom"`;
const active = (alias, at) =>
  `${alias}."effectiveFrom"<=${at} AND (${alias}."effectiveTo" IS NULL OR ${alias}."effectiveTo">${at})`;
add(`CREATE TABLE "MutationVersion" (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO "MutationVersion" VALUES(1,0);
CREATE TABLE "MutationGuard" (id INTEGER PRIMARY KEY CHECK(id=1), "expectedVersion" INTEGER NOT NULL, "startedAt" INTEGER NOT NULL);
INSERT INTO "MutationGuard" VALUES(1,0,0);`);
guard(
  "MutationGuard",
  "UPDATE",
  check(
    'NEW."expectedVersion"=(SELECT version FROM "MutationVersion" WHERE id=1) AND NEW."startedAt" BETWEEN unixepoch(\'subsec\')*1000-60000 AND unixepoch(\'subsec\')*1000+5000',
    "STALE_MUTATION",
  ),
);
for (const m of models) {
  const table =
    m.name === "CommissionPayment" ? "CommissionPaymentDraft" : m.name;
  const integerFields = m.fields.filter(
    (f) => f.type === "BigInt" || f.type === "Int",
  );
  for (const op of ["INSERT", "UPDATE"])
    if (integerFields.length)
      guard(
        table,
        op,
        integerFields
          .map((f) =>
            check(
              `${f.isRequired ? "" : `NEW."${f.name}" IS NULL OR `}(typeof(NEW."${f.name}")='integer' AND NEW."${f.name}" BETWEEN -9007199254740991 AND 9007199254740991)`,
              "Integer outside exact D1 range",
            ),
          )
          .join("\n"),
        "integers",
      );
  if (table !== "RateLimitBucket")
    for (const event of ["INSERT", "UPDATE", "DELETE"])
      add(
        `CREATE TRIGGER "${table}_${event}_version" AFTER ${event} ON "${table}" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;`,
      );
}
for (const table of [
  "Order",
  "OrderLine",
  "CommissionTransaction",
  "AuditEvent",
  "ProgramVersion",
  "CommissionPaymentDraft",
  "PaymentAllocation",
  "PaymentVoid",
])
  immutable(table);
guard(
  "AffiliateAccount",
  "INSERT",
  check(
    `NEW.type IN ('organization','creator') AND NEW.status IN ('pending','approved','rejected','suspended') AND ((NEW.type='organization' AND length(NEW."organizationRole")>0) OR (NEW.type='creator' AND NEW."organizationRole" IS NULL)) AND (NEW.status<>'approved' OR (NEW."verifiedAt" IS NOT NULL AND NEW."authSubject" IS NOT NULL AND NEW."organizationId" IS NOT NULL))`,
    "Invalid affiliate profile",
  ),
);
guard(
  "AffiliateAccount",
  "UPDATE",
  check(
    `NEW.type IN ('organization','creator') AND NEW.status IN ('pending','approved','rejected','suspended') AND ((NEW.type='organization' AND length(NEW."organizationRole")>0) OR (NEW.type='creator' AND NEW."organizationRole" IS NULL)) AND (NEW.status<>'approved' OR (NEW."verifiedAt" IS NOT NULL AND NEW."authSubject" IS NOT NULL AND NEW."organizationId" IS NOT NULL))`,
    "Invalid affiliate profile",
  ),
);
guard(
  "ProgramVersion",
  "INSERT",
  check(
    `${currency("NEW.currency")} AND ((NEW.kind='percentage' AND NEW."rateBps" BETWEEN 0 AND 10000 AND NEW."fixedMinor" IS NULL) OR (NEW.kind='fixed_item' AND NEW."rateBps"=0 AND NEW."fixedMinor">=0))`,
    "Invalid commission program",
  ),
);
for (const table of ["CommissionRate", "ProductAssignment"]) {
  const model = models.find((m) => m.name === table);
  const immutableFields = model.fields
    .filter((f) => f.kind !== "object" && f.name !== "effectiveTo")
    .map((f) => `NEW."${f.name}" IS OLD."${f.name}"`)
    .join(" AND ");
  guard(table, "DELETE", "SELECT RAISE(ABORT,'History cannot be deleted');");
  const fk = table === "CommissionRate" ? "rateId" : "assignmentId";
  guard(
    table,
    "UPDATE",
    check(
      `${immutableFields} AND NEW."effectiveTo" IS NOT NULL AND NEW."effectiveTo">=(SELECT "startedAt" FROM "MutationGuard" WHERE id=1) AND (SELECT "startedAt" FROM "MutationGuard" WHERE id=1)>=unixepoch('subsec')*1000-60000 AND (OLD."effectiveTo" IS NULL OR NEW."effectiveTo"<=OLD."effectiveTo") AND NOT EXISTS(SELECT 1 FROM "CommissionTransaction" WHERE "${fk}"=OLD.id AND type='sale' AND "occurredAt">=NEW."effectiveTo")`,
      "History can only be closed prospectively",
    ),
    "history",
  );
  const identity =
    table === "CommissionRate"
      ? 'r."organizationId"=NEW."organizationId"'
      : 'r."productGid"=NEW."productGid" AND r."variantGid" IS NEW."variantGid"';
  for (const op of ["INSERT", "UPDATE"])
    guard(
      table,
      op,
      check(
        `(${period}) AND NOT EXISTS(SELECT 1 FROM "${table}" r WHERE r.id<>NEW.id AND ${identity} AND (r."effectiveTo" IS NULL OR r."effectiveTo">NEW."effectiveFrom") AND (NEW."effectiveTo" IS NULL OR NEW."effectiveTo">r."effectiveFrom"))`,
        "Overlapping or invalid effective period",
      ),
      "period",
    );
}
guard(
  "CommissionRate",
  "INSERT",
  check('NEW."rateBps" BETWEEN 0 AND 10000', "Invalid commission rate"),
);
guard(
  "ProductAssignment",
  "INSERT",
  check(
    `NEW."productGid" LIKE 'gid://shopify/Product/%' AND length(substr(NEW."productGid",23))>0 AND substr(NEW."productGid",23) NOT GLOB '*[^0-9]*' AND (NEW."variantGid" IS NULL OR (NEW."variantGid" LIKE 'gid://shopify/ProductVariant/%' AND length(substr(NEW."variantGid",30))>0 AND substr(NEW."variantGid",30) NOT GLOB '*[^0-9]*'))`,
    "Invalid merchandise identifier",
  ),
);
guard("Order", "INSERT", check(currency("NEW.currency"), "Invalid currency"));
guard(
  "OrderLine",
  "INSERT",
  check(
    `NEW.quantity>0 AND NEW."grossMinor">=0 AND NEW."discountMinor">=0 AND NEW."discountMinor"<=NEW."grossMinor" AND NEW."netMinor"=NEW."grossMinor"-NEW."discountMinor" AND EXISTS(SELECT 1 FROM "Order" o WHERE o.id=NEW."orderId" AND o.currency=NEW.currency)`,
    "Invalid order line",
  ),
);
add(`CREATE UNIQUE INDEX "one_sale_per_line" ON "CommissionTransaction"("orderLineId") WHERE type='sale';
CREATE UNIQUE INDEX "one_event_per_line" ON "CommissionTransaction"(type,"sourceRef","orderLineId");`);
const percentage = `(NEW."baseMinor"/10000)*NEW."rateBps"+((NEW."baseMinor"%10000)*NEW."rateBps"+5000)/10000`;
const fixed = `(CASE WHEN NEW."fixedMinor">=NEW."baseMinor"/l.quantity+(NEW."baseMinor"%l.quantity<>0) THEN NEW."baseMinor" ELSE NEW."fixedMinor"*l.quantity END)`;
// Exact rounded a*b/d without multiplying two large monetary integers. Each
// intermediate is <= 3*MAX_SAFE_INTEGER, below SQLite's signed 64-bit bound.
const roundedRatio = (a, b, d) => `(WITH RECURSIVE ratio(n,q,r,a,b,d) AS (
SELECT 62,0,0,${a},${b},${d}
UNION ALL SELECT n-1,2*q+(2*r+((b>>n)&1)*a)/d,(2*r+((b>>n)&1)*a)%d,a,b,d FROM ratio WHERE n>=0
) SELECT q+(r>=d/2+d%2) FROM ratio WHERE n=-1)`;
const refunded = `(SELECT COALESCE(-SUM("baseMinor"),0) FROM "CommissionTransaction" WHERE "reversalOfId"=o.id)-NEW."baseMinor"`;
const reversed = `(SELECT COALESCE(-SUM("commissionMinor"),0) FROM "CommissionTransaction" WHERE "reversalOfId"=o.id)`;
guard(
  "CommissionTransaction",
  "INSERT",
  [
    check(
      `NEW."rateBps" BETWEEN 0 AND 10000 AND ${currency("NEW.currency")} AND NEW."refundedQuantity">=0 AND ((NEW."programVersionId" IS NULL AND NEW."rateId" IS NOT NULL AND NEW.kind='percentage' AND NEW."fixedMinor" IS NULL) OR (NEW."programVersionId" IS NOT NULL AND NEW."rateId" IS NULL))`,
      "Invalid ledger rule",
    ),
    check(
      `json_valid(NEW."sourceKey") AND json_array_length(NEW."sourceKey")=3 AND json_extract(NEW."sourceKey",'$[0]')=NEW.type AND json_extract(NEW."sourceKey",'$[1]')=NEW."sourceRef" AND length(NEW."sourceRef")>0 AND EXISTS(SELECT 1 FROM "OrderLine" l WHERE l.id=NEW."orderLineId" AND l."orderId"=NEW."orderId" AND l.currency=NEW.currency AND l."organizationId"=NEW."organizationId" AND json_extract(NEW."sourceKey",'$[2]')=l."lineGid")`,
      "Ledger identity or source mismatch",
    ),
    check(
      `(NEW.type='sale' AND NEW."baseMinor">=0 AND NEW."commissionMinor">=0 AND NEW."reversalOfId" IS NULL AND NEW."refundedQuantity"=0) OR (NEW.type='refund' AND NEW."baseMinor"<=0 AND NEW."commissionMinor"<=0 AND NEW."reversalOfId" IS NOT NULL AND (NEW."baseMinor"<0 OR NEW."refundedQuantity">0))`,
      "Invalid ledger signs",
    ),
    check(
      `NEW.type<>'sale' OR EXISTS(SELECT 1 FROM "OrderLine" l JOIN "Order" o ON o.id=l."orderId" JOIN "ProductAssignment" a ON a.id=NEW."assignmentId" WHERE l.id=NEW."orderLineId" AND o."occurredAt"=NEW."occurredAt" AND NEW."baseMinor"=l."netMinor" AND a."organizationId"=NEW."organizationId" AND a."productGid"=l."productGid" AND (a."variantGid" IS NULL OR a."variantGid"=l."variantGid") AND ${active("a", 'NEW."occurredAt"')} AND a."programVersionId" IS NEW."programVersionId" AND NOT EXISTS(SELECT 1 FROM "ProductAssignment" v WHERE a."variantGid" IS NULL AND v."productGid"=l."productGid" AND v."variantGid"=l."variantGid" AND ${active("v", 'NEW."occurredAt"')}) AND ((NEW."programVersionId" IS NULL AND EXISTS(SELECT 1 FROM "CommissionRate" r WHERE r.id=NEW."rateId" AND r."organizationId"=NEW."organizationId" AND r."rateBps"=NEW."rateBps" AND ${active("r", 'NEW."occurredAt"')})) OR EXISTS(SELECT 1 FROM "ProgramVersion" p WHERE p.id=NEW."programVersionId" AND p.kind=NEW.kind AND p."rateBps"=NEW."rateBps" AND p."fixedMinor" IS NEW."fixedMinor" AND p.currency=NEW.currency AND p."createdAt"<=NEW."occurredAt")) AND NEW."commissionMinor"=CASE WHEN NEW.kind='fixed_item' THEN ${fixed} ELSE ${percentage} END)`,
      "Invalid sale snapshot or calculation",
    ),
    check(
      `NEW.type<>'refund' OR EXISTS(SELECT 1 FROM "CommissionTransaction" o JOIN "OrderLine" l ON l.id=o."orderLineId" WHERE o.id=NEW."reversalOfId" AND o.type='sale' AND o."orderLineId"=NEW."orderLineId" AND o."rateId" IS NEW."rateId" AND o."programVersionId" IS NEW."programVersionId" AND o.kind=NEW.kind AND o."fixedMinor" IS NEW."fixedMinor" AND o."rateBps"=NEW."rateBps" AND o."assignmentId"=NEW."assignmentId" AND NEW."occurredAt">=o."occurredAt" AND ${refunded}<=o."baseMinor" AND NEW."refundedQuantity"+(SELECT COALESCE(SUM("refundedQuantity"),0) FROM "CommissionTransaction" WHERE "reversalOfId"=o.id)<=l.quantity AND NEW."commissionMinor"=-((CASE WHEN o."baseMinor"=0 THEN 0 ELSE ${roundedRatio('o."commissionMinor"', refunded, 'o."baseMinor"')} END)-${reversed}))`,
      "Invalid refund snapshot or rounding",
    ),
  ].join("\n"),
);
add(`CREATE TABLE "PaymentSeal" ("paymentId" TEXT PRIMARY KEY REFERENCES "CommissionPaymentDraft"(id) ON DELETE RESTRICT);
CREATE VIEW "CommissionPayment" AS SELECT p.* FROM "CommissionPaymentDraft" p JOIN "PaymentSeal" s ON s."paymentId"=p.id;`);
add(`CREATE TRIGGER "PaymentSeal_INSERT_version" AFTER INSERT ON "PaymentSeal" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;
CREATE INDEX "WebhookDelivery_ready" ON "WebhookDelivery"(shop,"processedAt","nextAttemptAt","receivedAt");`);
immutable("PaymentSeal");
guard(
  "CommissionPaymentDraft",
  "INSERT",
  check(
    `NEW."amountMinor">0 AND ${currency("NEW.currency")} AND NEW.method IN ('paypal','bank','other') AND length(trim(NEW.reference)) BETWEEN 1 AND 120 AND NEW."referenceKey"=NEW.method||':'||lower(NEW.reference) AND NEW."paidAt"<=unixepoch('subsec')*1000 AND length(NEW."recordedBy")>0 AND EXISTS(SELECT 1 FROM "AffiliateAccount" WHERE "organizationId"=NEW."organizationId" AND status='approved' AND "verifiedAt" IS NOT NULL AND "paypalEmail"=NEW."payeeEmail")`,
    "Invalid payment or payee",
  ),
);
const allocated = `(SELECT COALESCE(SUM(a."amountMinor"),0) FROM "PaymentAllocation" a WHERE a."transactionId"=t.id AND NOT EXISTS(SELECT 1 FROM "PaymentVoid" v WHERE v."paymentId"=a."paymentId"))+NEW."amountMinor"`;
guard(
  "PaymentAllocation",
  "INSERT",
  check(
    `NOT EXISTS(SELECT 1 FROM "PaymentSeal" WHERE "paymentId"=NEW."paymentId") AND NOT EXISTS(SELECT 1 FROM "PaymentVoid" WHERE "paymentId"=NEW."paymentId") AND EXISTS(SELECT 1 FROM "CommissionPaymentDraft" p JOIN "CommissionTransaction" t ON t.id=NEW."transactionId" WHERE p.id=NEW."paymentId" AND p."organizationId"=t."organizationId" AND p.currency=t.currency AND ((t."commissionMinor">=0 AND NEW."amountMinor">0 AND ${allocated}<=t."commissionMinor") OR (t."commissionMinor"<0 AND NEW."amountMinor"<0 AND ${allocated}>=t."commissionMinor")))`,
    "Invalid payment allocation",
  ),
);
guard(
  "PaymentSeal",
  "INSERT",
  check(
    `EXISTS(SELECT 1 FROM "CommissionPaymentDraft" p WHERE p.id=NEW."paymentId" AND p."amountMinor"=(SELECT COALESCE(SUM("amountMinor"),0) FROM "PaymentAllocation" WHERE "paymentId"=p.id) AND (EXISTS(SELECT 1 FROM "PaymentVoid" WHERE "paymentId"=p.id) OR p."amountMinor"+(SELECT COALESCE(SUM(paid."amountMinor"),0) FROM "CommissionPayment" paid WHERE paid."organizationId"=p."organizationId" AND paid.currency=p.currency AND NOT EXISTS(SELECT 1 FROM "PaymentVoid" WHERE "paymentId"=paid.id))<=(SELECT COALESCE(SUM("commissionMinor"),0) FROM "CommissionTransaction" WHERE "organizationId"=p."organizationId" AND currency=p.currency)))`,
    "Payment allocations or net balance mismatch",
  ),
);
guard(
  "PaymentVoid",
  "INSERT",
  check(
    `length(trim(NEW.reason)) BETWEEN 1 AND 500 AND length(NEW."recordedBy")>0`,
    "Invalid payment correction",
  ),
);
// Auth data is operational and expires; never store a code or session token.
add(`CREATE TABLE "AuthChallenge" (id TEXT PRIMARY KEY, email TEXT NOT NULL, "codeHash" TEXT NOT NULL, "expiresAt" INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, "consumedAt" INTEGER, "createdAt" INTEGER NOT NULL);
CREATE INDEX "AuthChallenge_email_createdAt" ON "AuthChallenge"(email,"createdAt");
CREATE TABLE "AuthSession" ("tokenHash" TEXT PRIMARY KEY, subject TEXT NOT NULL, email TEXT NOT NULL, "verifiedAt" INTEGER NOT NULL, "expiresAt" INTEGER NOT NULL);
CREATE INDEX "AuthSession_expiry" ON "AuthSession"("expiresAt");`);
await mkdir(new URL("../cloudflare/migrations", import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL("../cloudflare/migrations/0001_portal.sql", import.meta.url),
  sql,
);
