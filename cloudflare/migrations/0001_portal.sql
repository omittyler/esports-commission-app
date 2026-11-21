-- CreateTable
CREATE TABLE "AffiliateAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "organizationRole" TEXT,
    "paypalEmail" TEXT NOT NULL,
    "authSubject" TEXT,
    "verifiedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "organizationId" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AffiliateAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommissionProgram" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ProgramVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rateBps" INTEGER NOT NULL DEFAULT 0,
    "fixedMinor" BIGINT,
    "currency" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgramVersion_programId_fkey" FOREIGN KEY ("programId") REFERENCES "CommissionProgram" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "resourceGid" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "claimedAt" DATETIME,
    "claimToken" TEXT,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OrderSyncState" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "completedThrough" DATETIME,
    "lastCompletedAt" DATETIME,
    "lastFullScanAt" DATETIME,
    "windowFrom" DATETIME,
    "windowTo" DATETIME,
    "creationFloor" DATETIME,
    "cursor" TEXT,
    "cursorHistory" JSONB NOT NULL DEFAULT [],
    "fullSweep" BOOLEAN NOT NULL DEFAULT false,
    "forceFull" BOOLEAN NOT NULL DEFAULT false,
    "discovered" INTEGER NOT NULL DEFAULT 0,
    "claimToken" TEXT,
    "claimedAt" DATETIME,
    "nextScanAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "coverageGapAt" DATETIME,
    "coverageGapFrom" DATETIME,
    "coverageGapTo" DATETIME
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'organization',
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CommissionRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "variantGid" TEXT,
    "displayTitle" TEXT NOT NULL,
    "programVersionId" TEXT,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductAssignment_programVersionId_fkey" FOREIGN KEY ("programVersionId") REFERENCES "ProgramVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyOrderGid" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "currency" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "lineGid" TEXT NOT NULL,
    "productGid" TEXT,
    "variantGid" TEXT,
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "organizationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommissionTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "rateId" TEXT,
    "programVersionId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'percentage',
    "fixedMinor" BIGINT,
    "refundedQuantity" INTEGER NOT NULL DEFAULT 0,
    "assignmentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "baseMinor" BIGINT NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "commissionMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "reversalOfId" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommissionTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommissionTransaction_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommissionTransaction_rateId_fkey" FOREIGN KEY ("rateId") REFERENCES "CommissionRate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommissionTransaction_programVersionId_fkey" FOREIGN KEY ("programVersionId") REFERENCES "ProgramVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommissionTransaction_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ProductAssignment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommissionTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "CommissionTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommissionPaymentDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "paidAt" DATETIME NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "referenceKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payeeEmail" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CommissionPaymentDraft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentAllocation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "CommissionTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentVoid" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentVoid_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CommissionPaymentDraft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateAccount_email_key" ON "AffiliateAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateAccount_authSubject_key" ON "AffiliateAccount"("authSubject");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateAccount_organizationId_key" ON "AffiliateAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_shop_topic_eventId_key" ON "WebhookDelivery"("shop", "topic", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRate_organizationId_effectiveFrom_key" ON "CommissionRate"("organizationId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ProductAssignment_productGid_variantGid_effectiveFrom_idx" ON "ProductAssignment"("productGid", "variantGid", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Order_shopifyOrderGid_key" ON "Order"("shopifyOrderGid");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLine_lineGid_key" ON "OrderLine"("lineGid");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionTransaction_sourceKey_key" ON "CommissionTransaction"("sourceKey");

-- CreateIndex
CREATE INDEX "CommissionTransaction_organizationId_occurredAt_idx" ON "CommissionTransaction"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "CommissionTransaction_reversalOfId_idx" ON "CommissionTransaction"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionPayment_referenceKey_key" ON "CommissionPaymentDraft"("referenceKey");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionPayment_idempotencyKey_key" ON "CommissionPaymentDraft"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CommissionPayment_organizationId_paidAt_idx" ON "CommissionPaymentDraft"("organizationId", "paidAt");

-- CreateIndex
CREATE INDEX "PaymentAllocation_transactionId_idx" ON "PaymentAllocation"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_transactionId_key" ON "PaymentAllocation"("paymentId", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentVoid_paymentId_key" ON "PaymentVoid"("paymentId");

CREATE TABLE "MutationVersion" (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO "MutationVersion" VALUES(1,0);
CREATE TABLE "MutationGuard" (id INTEGER PRIMARY KEY CHECK(id=1), "expectedVersion" INTEGER NOT NULL, "startedAt" INTEGER NOT NULL);
INSERT INTO "MutationGuard" VALUES(1,0,0);

CREATE TRIGGER "MutationGuard_UPDATE_guard" BEFORE UPDATE ON "MutationGuard" BEGIN
SELECT CASE WHEN (NEW."expectedVersion"=(SELECT version FROM "MutationVersion" WHERE id=1) AND NEW."startedAt" BETWEEN unixepoch('subsec')*1000-60000 AND unixepoch('subsec')*1000+5000) IS NOT 1 THEN RAISE(ABORT,'STALE_MUTATION') END;
END;

CREATE TRIGGER "AffiliateAccount_INSERT_version" AFTER INSERT ON "AffiliateAccount" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "AffiliateAccount_UPDATE_version" AFTER UPDATE ON "AffiliateAccount" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "AffiliateAccount_DELETE_version" AFTER DELETE ON "AffiliateAccount" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "CommissionProgram_INSERT_version" AFTER INSERT ON "CommissionProgram" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "CommissionProgram_UPDATE_version" AFTER UPDATE ON "CommissionProgram" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "CommissionProgram_DELETE_version" AFTER DELETE ON "CommissionProgram" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "ProgramVersion_INSERT_integers" BEFORE INSERT ON "ProgramVersion" BEGIN
SELECT CASE WHEN ((typeof(NEW."rateBps")='integer' AND NEW."rateBps" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN (NEW."fixedMinor" IS NULL OR (typeof(NEW."fixedMinor")='integer' AND NEW."fixedMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "ProgramVersion_UPDATE_integers" BEFORE UPDATE ON "ProgramVersion" BEGIN
SELECT CASE WHEN ((typeof(NEW."rateBps")='integer' AND NEW."rateBps" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN (NEW."fixedMinor" IS NULL OR (typeof(NEW."fixedMinor")='integer' AND NEW."fixedMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "ProgramVersion_INSERT_version" AFTER INSERT ON "ProgramVersion" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "ProgramVersion_UPDATE_version" AFTER UPDATE ON "ProgramVersion" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "ProgramVersion_DELETE_version" AFTER DELETE ON "ProgramVersion" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "RateLimitBucket_INSERT_integers" BEFORE INSERT ON "RateLimitBucket" BEGIN
SELECT CASE WHEN ((typeof(NEW."count")='integer' AND NEW."count" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "RateLimitBucket_UPDATE_integers" BEFORE UPDATE ON "RateLimitBucket" BEGIN
SELECT CASE WHEN ((typeof(NEW."count")='integer' AND NEW."count" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "WebhookDelivery_INSERT_integers" BEFORE INSERT ON "WebhookDelivery" BEGIN
SELECT CASE WHEN ((typeof(NEW."attempts")='integer' AND NEW."attempts" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "WebhookDelivery_UPDATE_integers" BEFORE UPDATE ON "WebhookDelivery" BEGIN
SELECT CASE WHEN ((typeof(NEW."attempts")='integer' AND NEW."attempts" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "WebhookDelivery_INSERT_version" AFTER INSERT ON "WebhookDelivery" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "WebhookDelivery_UPDATE_version" AFTER UPDATE ON "WebhookDelivery" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "WebhookDelivery_DELETE_version" AFTER DELETE ON "WebhookDelivery" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "OrderSyncState_INSERT_integers" BEFORE INSERT ON "OrderSyncState" BEGIN
SELECT CASE WHEN ((typeof(NEW."discovered")='integer' AND NEW."discovered" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "OrderSyncState_UPDATE_integers" BEFORE UPDATE ON "OrderSyncState" BEGIN
SELECT CASE WHEN ((typeof(NEW."discovered")='integer' AND NEW."discovered" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "OrderSyncState_INSERT_version" AFTER INSERT ON "OrderSyncState" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "OrderSyncState_UPDATE_version" AFTER UPDATE ON "OrderSyncState" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "OrderSyncState_DELETE_version" AFTER DELETE ON "OrderSyncState" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "Organization_INSERT_version" AFTER INSERT ON "Organization" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "Organization_UPDATE_version" AFTER UPDATE ON "Organization" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "Organization_DELETE_version" AFTER DELETE ON "Organization" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "CommissionRate_INSERT_integers" BEFORE INSERT ON "CommissionRate" BEGIN
SELECT CASE WHEN ((typeof(NEW."rateBps")='integer' AND NEW."rateBps" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "CommissionRate_UPDATE_integers" BEFORE UPDATE ON "CommissionRate" BEGIN
SELECT CASE WHEN ((typeof(NEW."rateBps")='integer' AND NEW."rateBps" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "CommissionRate_INSERT_version" AFTER INSERT ON "CommissionRate" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "CommissionRate_UPDATE_version" AFTER UPDATE ON "CommissionRate" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "CommissionRate_DELETE_version" AFTER DELETE ON "CommissionRate" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "ProductAssignment_INSERT_version" AFTER INSERT ON "ProductAssignment" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "ProductAssignment_UPDATE_version" AFTER UPDATE ON "ProductAssignment" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "ProductAssignment_DELETE_version" AFTER DELETE ON "ProductAssignment" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "Order_INSERT_version" AFTER INSERT ON "Order" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "Order_UPDATE_version" AFTER UPDATE ON "Order" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "Order_DELETE_version" AFTER DELETE ON "Order" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "OrderLine_INSERT_integers" BEFORE INSERT ON "OrderLine" BEGIN
SELECT CASE WHEN ((typeof(NEW."quantity")='integer' AND NEW."quantity" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."grossMinor")='integer' AND NEW."grossMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."discountMinor")='integer' AND NEW."discountMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."netMinor")='integer' AND NEW."netMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "OrderLine_UPDATE_integers" BEFORE UPDATE ON "OrderLine" BEGIN
SELECT CASE WHEN ((typeof(NEW."quantity")='integer' AND NEW."quantity" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."grossMinor")='integer' AND NEW."grossMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."discountMinor")='integer' AND NEW."discountMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."netMinor")='integer' AND NEW."netMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "OrderLine_INSERT_version" AFTER INSERT ON "OrderLine" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "OrderLine_UPDATE_version" AFTER UPDATE ON "OrderLine" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "OrderLine_DELETE_version" AFTER DELETE ON "OrderLine" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "CommissionTransaction_INSERT_integers" BEFORE INSERT ON "CommissionTransaction" BEGIN
SELECT CASE WHEN (NEW."fixedMinor" IS NULL OR (typeof(NEW."fixedMinor")='integer' AND NEW."fixedMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."refundedQuantity")='integer' AND NEW."refundedQuantity" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."baseMinor")='integer' AND NEW."baseMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."rateBps")='integer' AND NEW."rateBps" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."commissionMinor")='integer' AND NEW."commissionMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "CommissionTransaction_UPDATE_integers" BEFORE UPDATE ON "CommissionTransaction" BEGIN
SELECT CASE WHEN (NEW."fixedMinor" IS NULL OR (typeof(NEW."fixedMinor")='integer' AND NEW."fixedMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."refundedQuantity")='integer' AND NEW."refundedQuantity" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."baseMinor")='integer' AND NEW."baseMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."rateBps")='integer' AND NEW."rateBps" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
SELECT CASE WHEN ((typeof(NEW."commissionMinor")='integer' AND NEW."commissionMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "CommissionTransaction_INSERT_version" AFTER INSERT ON "CommissionTransaction" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "CommissionTransaction_UPDATE_version" AFTER UPDATE ON "CommissionTransaction" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "CommissionTransaction_DELETE_version" AFTER DELETE ON "CommissionTransaction" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "CommissionPaymentDraft_INSERT_integers" BEFORE INSERT ON "CommissionPaymentDraft" BEGIN
SELECT CASE WHEN ((typeof(NEW."amountMinor")='integer' AND NEW."amountMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "CommissionPaymentDraft_UPDATE_integers" BEFORE UPDATE ON "CommissionPaymentDraft" BEGIN
SELECT CASE WHEN ((typeof(NEW."amountMinor")='integer' AND NEW."amountMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "CommissionPaymentDraft_INSERT_version" AFTER INSERT ON "CommissionPaymentDraft" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "CommissionPaymentDraft_UPDATE_version" AFTER UPDATE ON "CommissionPaymentDraft" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "CommissionPaymentDraft_DELETE_version" AFTER DELETE ON "CommissionPaymentDraft" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "PaymentAllocation_INSERT_integers" BEFORE INSERT ON "PaymentAllocation" BEGIN
SELECT CASE WHEN ((typeof(NEW."amountMinor")='integer' AND NEW."amountMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "PaymentAllocation_UPDATE_integers" BEFORE UPDATE ON "PaymentAllocation" BEGIN
SELECT CASE WHEN ((typeof(NEW."amountMinor")='integer' AND NEW."amountMinor" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "PaymentAllocation_INSERT_version" AFTER INSERT ON "PaymentAllocation" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "PaymentAllocation_UPDATE_version" AFTER UPDATE ON "PaymentAllocation" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "PaymentAllocation_DELETE_version" AFTER DELETE ON "PaymentAllocation" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "PaymentVoid_INSERT_version" AFTER INSERT ON "PaymentVoid" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "PaymentVoid_UPDATE_version" AFTER UPDATE ON "PaymentVoid" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "PaymentVoid_DELETE_version" AFTER DELETE ON "PaymentVoid" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "AuditEvent_INSERT_version" AFTER INSERT ON "AuditEvent" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "AuditEvent_UPDATE_version" AFTER UPDATE ON "AuditEvent" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "AuditEvent_DELETE_version" AFTER DELETE ON "AuditEvent" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "Session_INSERT_integers" BEFORE INSERT ON "Session" BEGIN
SELECT CASE WHEN (NEW."userId" IS NULL OR (typeof(NEW."userId")='integer' AND NEW."userId" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "Session_UPDATE_integers" BEFORE UPDATE ON "Session" BEGIN
SELECT CASE WHEN (NEW."userId" IS NULL OR (typeof(NEW."userId")='integer' AND NEW."userId" BETWEEN -9007199254740991 AND 9007199254740991)) IS NOT 1 THEN RAISE(ABORT,'Integer outside exact D1 range') END;
END;

CREATE TRIGGER "Session_INSERT_version" AFTER INSERT ON "Session" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "Session_UPDATE_version" AFTER UPDATE ON "Session" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "Session_DELETE_version" AFTER DELETE ON "Session" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;

CREATE TRIGGER "Order_UPDATE_immutable" BEFORE UPDATE ON "Order" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "Order_DELETE_immutable" BEFORE DELETE ON "Order" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "OrderLine_UPDATE_immutable" BEFORE UPDATE ON "OrderLine" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "OrderLine_DELETE_immutable" BEFORE DELETE ON "OrderLine" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "CommissionTransaction_UPDATE_immutable" BEFORE UPDATE ON "CommissionTransaction" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "CommissionTransaction_DELETE_immutable" BEFORE DELETE ON "CommissionTransaction" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "AuditEvent_UPDATE_immutable" BEFORE UPDATE ON "AuditEvent" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "AuditEvent_DELETE_immutable" BEFORE DELETE ON "AuditEvent" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "ProgramVersion_UPDATE_immutable" BEFORE UPDATE ON "ProgramVersion" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "ProgramVersion_DELETE_immutable" BEFORE DELETE ON "ProgramVersion" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "CommissionPaymentDraft_UPDATE_immutable" BEFORE UPDATE ON "CommissionPaymentDraft" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "CommissionPaymentDraft_DELETE_immutable" BEFORE DELETE ON "CommissionPaymentDraft" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "PaymentAllocation_UPDATE_immutable" BEFORE UPDATE ON "PaymentAllocation" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "PaymentAllocation_DELETE_immutable" BEFORE DELETE ON "PaymentAllocation" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "PaymentVoid_UPDATE_immutable" BEFORE UPDATE ON "PaymentVoid" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "PaymentVoid_DELETE_immutable" BEFORE DELETE ON "PaymentVoid" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "AffiliateAccount_INSERT_guard" BEFORE INSERT ON "AffiliateAccount" BEGIN
SELECT CASE WHEN (NEW.type IN ('organization','creator') AND NEW.status IN ('pending','approved','rejected','suspended') AND ((NEW.type='organization' AND length(NEW."organizationRole")>0) OR (NEW.type='creator' AND NEW."organizationRole" IS NULL)) AND (NEW.status<>'approved' OR (NEW."verifiedAt" IS NOT NULL AND NEW."authSubject" IS NOT NULL AND NEW."organizationId" IS NOT NULL))) IS NOT 1 THEN RAISE(ABORT,'Invalid affiliate profile') END;
END;

CREATE TRIGGER "AffiliateAccount_UPDATE_guard" BEFORE UPDATE ON "AffiliateAccount" BEGIN
SELECT CASE WHEN (NEW.type IN ('organization','creator') AND NEW.status IN ('pending','approved','rejected','suspended') AND ((NEW.type='organization' AND length(NEW."organizationRole")>0) OR (NEW.type='creator' AND NEW."organizationRole" IS NULL)) AND (NEW.status<>'approved' OR (NEW."verifiedAt" IS NOT NULL AND NEW."authSubject" IS NOT NULL AND NEW."organizationId" IS NOT NULL))) IS NOT 1 THEN RAISE(ABORT,'Invalid affiliate profile') END;
END;

CREATE TRIGGER "ProgramVersion_INSERT_guard" BEFORE INSERT ON "ProgramVersion" BEGIN
SELECT CASE WHEN (NEW.currency GLOB '[A-Z][A-Z][A-Z]' AND length(NEW.currency)=3 AND ((NEW.kind='percentage' AND NEW."rateBps" BETWEEN 0 AND 10000 AND NEW."fixedMinor" IS NULL) OR (NEW.kind='fixed_item' AND NEW."rateBps"=0 AND NEW."fixedMinor">=0))) IS NOT 1 THEN RAISE(ABORT,'Invalid commission program') END;
END;

CREATE TRIGGER "CommissionRate_DELETE_guard" BEFORE DELETE ON "CommissionRate" BEGIN
SELECT RAISE(ABORT,'History cannot be deleted');
END;

CREATE TRIGGER "CommissionRate_UPDATE_history" BEFORE UPDATE ON "CommissionRate" BEGIN
SELECT CASE WHEN (NEW."id" IS OLD."id" AND NEW."organizationId" IS OLD."organizationId" AND NEW."rateBps" IS OLD."rateBps" AND NEW."effectiveFrom" IS OLD."effectiveFrom" AND NEW."createdAt" IS OLD."createdAt" AND NEW."effectiveTo" IS NOT NULL AND NEW."effectiveTo">=(SELECT "startedAt" FROM "MutationGuard" WHERE id=1) AND (SELECT "startedAt" FROM "MutationGuard" WHERE id=1)>=unixepoch('subsec')*1000-60000 AND (OLD."effectiveTo" IS NULL OR NEW."effectiveTo"<=OLD."effectiveTo") AND NOT EXISTS(SELECT 1 FROM "CommissionTransaction" WHERE "rateId"=OLD.id AND type='sale' AND "occurredAt">=NEW."effectiveTo")) IS NOT 1 THEN RAISE(ABORT,'History can only be closed prospectively') END;
END;

CREATE TRIGGER "CommissionRate_INSERT_period" BEFORE INSERT ON "CommissionRate" BEGIN
SELECT CASE WHEN ((NEW."effectiveTo" IS NULL OR NEW."effectiveTo">NEW."effectiveFrom") AND NOT EXISTS(SELECT 1 FROM "CommissionRate" r WHERE r.id<>NEW.id AND r."organizationId"=NEW."organizationId" AND (r."effectiveTo" IS NULL OR r."effectiveTo">NEW."effectiveFrom") AND (NEW."effectiveTo" IS NULL OR NEW."effectiveTo">r."effectiveFrom"))) IS NOT 1 THEN RAISE(ABORT,'Overlapping or invalid effective period') END;
END;

CREATE TRIGGER "CommissionRate_UPDATE_period" BEFORE UPDATE ON "CommissionRate" BEGIN
SELECT CASE WHEN ((NEW."effectiveTo" IS NULL OR NEW."effectiveTo">NEW."effectiveFrom") AND NOT EXISTS(SELECT 1 FROM "CommissionRate" r WHERE r.id<>NEW.id AND r."organizationId"=NEW."organizationId" AND (r."effectiveTo" IS NULL OR r."effectiveTo">NEW."effectiveFrom") AND (NEW."effectiveTo" IS NULL OR NEW."effectiveTo">r."effectiveFrom"))) IS NOT 1 THEN RAISE(ABORT,'Overlapping or invalid effective period') END;
END;

CREATE TRIGGER "ProductAssignment_DELETE_guard" BEFORE DELETE ON "ProductAssignment" BEGIN
SELECT RAISE(ABORT,'History cannot be deleted');
END;

CREATE TRIGGER "ProductAssignment_UPDATE_history" BEFORE UPDATE ON "ProductAssignment" BEGIN
SELECT CASE WHEN (NEW."id" IS OLD."id" AND NEW."organizationId" IS OLD."organizationId" AND NEW."productGid" IS OLD."productGid" AND NEW."variantGid" IS OLD."variantGid" AND NEW."displayTitle" IS OLD."displayTitle" AND NEW."programVersionId" IS OLD."programVersionId" AND NEW."effectiveFrom" IS OLD."effectiveFrom" AND NEW."createdAt" IS OLD."createdAt" AND NEW."effectiveTo" IS NOT NULL AND NEW."effectiveTo">=(SELECT "startedAt" FROM "MutationGuard" WHERE id=1) AND (SELECT "startedAt" FROM "MutationGuard" WHERE id=1)>=unixepoch('subsec')*1000-60000 AND (OLD."effectiveTo" IS NULL OR NEW."effectiveTo"<=OLD."effectiveTo") AND NOT EXISTS(SELECT 1 FROM "CommissionTransaction" WHERE "assignmentId"=OLD.id AND type='sale' AND "occurredAt">=NEW."effectiveTo")) IS NOT 1 THEN RAISE(ABORT,'History can only be closed prospectively') END;
END;

CREATE TRIGGER "ProductAssignment_INSERT_period" BEFORE INSERT ON "ProductAssignment" BEGIN
SELECT CASE WHEN ((NEW."effectiveTo" IS NULL OR NEW."effectiveTo">NEW."effectiveFrom") AND NOT EXISTS(SELECT 1 FROM "ProductAssignment" r WHERE r.id<>NEW.id AND r."productGid"=NEW."productGid" AND r."variantGid" IS NEW."variantGid" AND (r."effectiveTo" IS NULL OR r."effectiveTo">NEW."effectiveFrom") AND (NEW."effectiveTo" IS NULL OR NEW."effectiveTo">r."effectiveFrom"))) IS NOT 1 THEN RAISE(ABORT,'Overlapping or invalid effective period') END;
END;

CREATE TRIGGER "ProductAssignment_UPDATE_period" BEFORE UPDATE ON "ProductAssignment" BEGIN
SELECT CASE WHEN ((NEW."effectiveTo" IS NULL OR NEW."effectiveTo">NEW."effectiveFrom") AND NOT EXISTS(SELECT 1 FROM "ProductAssignment" r WHERE r.id<>NEW.id AND r."productGid"=NEW."productGid" AND r."variantGid" IS NEW."variantGid" AND (r."effectiveTo" IS NULL OR r."effectiveTo">NEW."effectiveFrom") AND (NEW."effectiveTo" IS NULL OR NEW."effectiveTo">r."effectiveFrom"))) IS NOT 1 THEN RAISE(ABORT,'Overlapping or invalid effective period') END;
END;

CREATE TRIGGER "CommissionRate_INSERT_guard" BEFORE INSERT ON "CommissionRate" BEGIN
SELECT CASE WHEN (NEW."rateBps" BETWEEN 0 AND 10000) IS NOT 1 THEN RAISE(ABORT,'Invalid commission rate') END;
END;

CREATE TRIGGER "ProductAssignment_INSERT_guard" BEFORE INSERT ON "ProductAssignment" BEGIN
SELECT CASE WHEN (NEW."productGid" LIKE 'gid://shopify/Product/%' AND length(substr(NEW."productGid",23))>0 AND substr(NEW."productGid",23) NOT GLOB '*[^0-9]*' AND (NEW."variantGid" IS NULL OR (NEW."variantGid" LIKE 'gid://shopify/ProductVariant/%' AND length(substr(NEW."variantGid",30))>0 AND substr(NEW."variantGid",30) NOT GLOB '*[^0-9]*'))) IS NOT 1 THEN RAISE(ABORT,'Invalid merchandise identifier') END;
END;

CREATE TRIGGER "Order_INSERT_guard" BEFORE INSERT ON "Order" BEGIN
SELECT CASE WHEN (NEW.currency GLOB '[A-Z][A-Z][A-Z]' AND length(NEW.currency)=3) IS NOT 1 THEN RAISE(ABORT,'Invalid currency') END;
END;

CREATE TRIGGER "OrderLine_INSERT_guard" BEFORE INSERT ON "OrderLine" BEGIN
SELECT CASE WHEN (NEW.quantity>0 AND NEW."grossMinor">=0 AND NEW."discountMinor">=0 AND NEW."discountMinor"<=NEW."grossMinor" AND NEW."netMinor"=NEW."grossMinor"-NEW."discountMinor" AND EXISTS(SELECT 1 FROM "Order" o WHERE o.id=NEW."orderId" AND o.currency=NEW.currency)) IS NOT 1 THEN RAISE(ABORT,'Invalid order line') END;
END;

CREATE UNIQUE INDEX "one_sale_per_line" ON "CommissionTransaction"("orderLineId") WHERE type='sale';
CREATE UNIQUE INDEX "one_event_per_line" ON "CommissionTransaction"(type,"sourceRef","orderLineId");

CREATE TRIGGER "CommissionTransaction_INSERT_guard" BEFORE INSERT ON "CommissionTransaction" BEGIN
SELECT CASE WHEN (NEW."rateBps" BETWEEN 0 AND 10000 AND NEW.currency GLOB '[A-Z][A-Z][A-Z]' AND length(NEW.currency)=3 AND NEW."refundedQuantity">=0 AND ((NEW."programVersionId" IS NULL AND NEW."rateId" IS NOT NULL AND NEW.kind='percentage' AND NEW."fixedMinor" IS NULL) OR (NEW."programVersionId" IS NOT NULL AND NEW."rateId" IS NULL))) IS NOT 1 THEN RAISE(ABORT,'Invalid ledger rule') END;
SELECT CASE WHEN (json_valid(NEW."sourceKey") AND json_array_length(NEW."sourceKey")=3 AND json_extract(NEW."sourceKey",'$[0]')=NEW.type AND json_extract(NEW."sourceKey",'$[1]')=NEW."sourceRef" AND length(NEW."sourceRef")>0 AND EXISTS(SELECT 1 FROM "OrderLine" l WHERE l.id=NEW."orderLineId" AND l."orderId"=NEW."orderId" AND l.currency=NEW.currency AND l."organizationId"=NEW."organizationId" AND json_extract(NEW."sourceKey",'$[2]')=l."lineGid")) IS NOT 1 THEN RAISE(ABORT,'Ledger identity or source mismatch') END;
SELECT CASE WHEN ((NEW.type='sale' AND NEW."baseMinor">=0 AND NEW."commissionMinor">=0 AND NEW."reversalOfId" IS NULL AND NEW."refundedQuantity"=0) OR (NEW.type='refund' AND NEW."baseMinor"<=0 AND NEW."commissionMinor"<=0 AND NEW."reversalOfId" IS NOT NULL AND (NEW."baseMinor"<0 OR NEW."refundedQuantity">0))) IS NOT 1 THEN RAISE(ABORT,'Invalid ledger signs') END;
SELECT CASE WHEN (NEW.type<>'sale' OR EXISTS(SELECT 1 FROM "OrderLine" l JOIN "Order" o ON o.id=l."orderId" JOIN "ProductAssignment" a ON a.id=NEW."assignmentId" WHERE l.id=NEW."orderLineId" AND o."occurredAt"=NEW."occurredAt" AND NEW."baseMinor"=l."netMinor" AND a."organizationId"=NEW."organizationId" AND a."productGid"=l."productGid" AND (a."variantGid" IS NULL OR a."variantGid"=l."variantGid") AND a."effectiveFrom"<=NEW."occurredAt" AND (a."effectiveTo" IS NULL OR a."effectiveTo">NEW."occurredAt") AND a."programVersionId" IS NEW."programVersionId" AND NOT EXISTS(SELECT 1 FROM "ProductAssignment" v WHERE a."variantGid" IS NULL AND v."productGid"=l."productGid" AND v."variantGid"=l."variantGid" AND v."effectiveFrom"<=NEW."occurredAt" AND (v."effectiveTo" IS NULL OR v."effectiveTo">NEW."occurredAt")) AND ((NEW."programVersionId" IS NULL AND EXISTS(SELECT 1 FROM "CommissionRate" r WHERE r.id=NEW."rateId" AND r."organizationId"=NEW."organizationId" AND r."rateBps"=NEW."rateBps" AND r."effectiveFrom"<=NEW."occurredAt" AND (r."effectiveTo" IS NULL OR r."effectiveTo">NEW."occurredAt"))) OR EXISTS(SELECT 1 FROM "ProgramVersion" p WHERE p.id=NEW."programVersionId" AND p.kind=NEW.kind AND p."rateBps"=NEW."rateBps" AND p."fixedMinor" IS NEW."fixedMinor" AND p.currency=NEW.currency AND p."createdAt"<=NEW."occurredAt")) AND NEW."commissionMinor"=CASE WHEN NEW.kind='fixed_item' THEN (CASE WHEN NEW."fixedMinor">=NEW."baseMinor"/l.quantity+(NEW."baseMinor"%l.quantity<>0) THEN NEW."baseMinor" ELSE NEW."fixedMinor"*l.quantity END) ELSE (NEW."baseMinor"/10000)*NEW."rateBps"+((NEW."baseMinor"%10000)*NEW."rateBps"+5000)/10000 END)) IS NOT 1 THEN RAISE(ABORT,'Invalid sale snapshot or calculation') END;
SELECT CASE WHEN (NEW.type<>'refund' OR EXISTS(SELECT 1 FROM "CommissionTransaction" o JOIN "OrderLine" l ON l.id=o."orderLineId" WHERE o.id=NEW."reversalOfId" AND o.type='sale' AND o."orderLineId"=NEW."orderLineId" AND o."rateId" IS NEW."rateId" AND o."programVersionId" IS NEW."programVersionId" AND o.kind=NEW.kind AND o."fixedMinor" IS NEW."fixedMinor" AND o."rateBps"=NEW."rateBps" AND o."assignmentId"=NEW."assignmentId" AND NEW."occurredAt">=o."occurredAt" AND (SELECT COALESCE(-SUM("baseMinor"),0) FROM "CommissionTransaction" WHERE "reversalOfId"=o.id)-NEW."baseMinor"<=o."baseMinor" AND NEW."refundedQuantity"+(SELECT COALESCE(SUM("refundedQuantity"),0) FROM "CommissionTransaction" WHERE "reversalOfId"=o.id)<=l.quantity AND NEW."commissionMinor"=-((CASE WHEN o."baseMinor"=0 THEN 0 ELSE (WITH RECURSIVE ratio(n,q,r,a,b,d) AS (
SELECT 62,0,0,o."commissionMinor",(SELECT COALESCE(-SUM("baseMinor"),0) FROM "CommissionTransaction" WHERE "reversalOfId"=o.id)-NEW."baseMinor",o."baseMinor"
UNION ALL SELECT n-1,2*q+(2*r+((b>>n)&1)*a)/d,(2*r+((b>>n)&1)*a)%d,a,b,d FROM ratio WHERE n>=0
) SELECT q+(r>=d/2+d%2) FROM ratio WHERE n=-1) END)-(SELECT COALESCE(-SUM("commissionMinor"),0) FROM "CommissionTransaction" WHERE "reversalOfId"=o.id)))) IS NOT 1 THEN RAISE(ABORT,'Invalid refund snapshot or rounding') END;
END;

CREATE TABLE "PaymentSeal" ("paymentId" TEXT PRIMARY KEY REFERENCES "CommissionPaymentDraft"(id) ON DELETE RESTRICT);
CREATE VIEW "CommissionPayment" AS SELECT p.* FROM "CommissionPaymentDraft" p JOIN "PaymentSeal" s ON s."paymentId"=p.id;

CREATE TRIGGER "PaymentSeal_INSERT_version" AFTER INSERT ON "PaymentSeal" BEGIN UPDATE "MutationVersion" SET version=version+1 WHERE id=1; END;
CREATE INDEX "WebhookDelivery_ready" ON "WebhookDelivery"(shop,"processedAt","nextAttemptAt","receivedAt");

CREATE TRIGGER "PaymentSeal_UPDATE_immutable" BEFORE UPDATE ON "PaymentSeal" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "PaymentSeal_DELETE_immutable" BEFORE DELETE ON "PaymentSeal" BEGIN
SELECT RAISE(ABORT,'Append-only financial history');
END;

CREATE TRIGGER "CommissionPaymentDraft_INSERT_guard" BEFORE INSERT ON "CommissionPaymentDraft" BEGIN
SELECT CASE WHEN (NEW."amountMinor">0 AND NEW.currency GLOB '[A-Z][A-Z][A-Z]' AND length(NEW.currency)=3 AND NEW.method IN ('paypal','bank','other') AND length(trim(NEW.reference)) BETWEEN 1 AND 120 AND NEW."referenceKey"=NEW.method||':'||lower(NEW.reference) AND NEW."paidAt"<=unixepoch('subsec')*1000 AND length(NEW."recordedBy")>0 AND EXISTS(SELECT 1 FROM "AffiliateAccount" WHERE "organizationId"=NEW."organizationId" AND status='approved' AND "verifiedAt" IS NOT NULL AND "paypalEmail"=NEW."payeeEmail")) IS NOT 1 THEN RAISE(ABORT,'Invalid payment or payee') END;
END;

CREATE TRIGGER "PaymentAllocation_INSERT_guard" BEFORE INSERT ON "PaymentAllocation" BEGIN
SELECT CASE WHEN (NOT EXISTS(SELECT 1 FROM "PaymentSeal" WHERE "paymentId"=NEW."paymentId") AND NOT EXISTS(SELECT 1 FROM "PaymentVoid" WHERE "paymentId"=NEW."paymentId") AND EXISTS(SELECT 1 FROM "CommissionPaymentDraft" p JOIN "CommissionTransaction" t ON t.id=NEW."transactionId" WHERE p.id=NEW."paymentId" AND p."organizationId"=t."organizationId" AND p.currency=t.currency AND ((t."commissionMinor">=0 AND NEW."amountMinor">0 AND (SELECT COALESCE(SUM(a."amountMinor"),0) FROM "PaymentAllocation" a WHERE a."transactionId"=t.id AND NOT EXISTS(SELECT 1 FROM "PaymentVoid" v WHERE v."paymentId"=a."paymentId"))+NEW."amountMinor"<=t."commissionMinor") OR (t."commissionMinor"<0 AND NEW."amountMinor"<0 AND (SELECT COALESCE(SUM(a."amountMinor"),0) FROM "PaymentAllocation" a WHERE a."transactionId"=t.id AND NOT EXISTS(SELECT 1 FROM "PaymentVoid" v WHERE v."paymentId"=a."paymentId"))+NEW."amountMinor">=t."commissionMinor")))) IS NOT 1 THEN RAISE(ABORT,'Invalid payment allocation') END;
END;

CREATE TRIGGER "PaymentSeal_INSERT_guard" BEFORE INSERT ON "PaymentSeal" BEGIN
SELECT CASE WHEN (EXISTS(SELECT 1 FROM "CommissionPaymentDraft" p WHERE p.id=NEW."paymentId" AND p."amountMinor"=(SELECT COALESCE(SUM("amountMinor"),0) FROM "PaymentAllocation" WHERE "paymentId"=p.id) AND (EXISTS(SELECT 1 FROM "PaymentVoid" WHERE "paymentId"=p.id) OR p."amountMinor"+(SELECT COALESCE(SUM(paid."amountMinor"),0) FROM "CommissionPayment" paid WHERE paid."organizationId"=p."organizationId" AND paid.currency=p.currency AND NOT EXISTS(SELECT 1 FROM "PaymentVoid" WHERE "paymentId"=paid.id))<=(SELECT COALESCE(SUM("commissionMinor"),0) FROM "CommissionTransaction" WHERE "organizationId"=p."organizationId" AND currency=p.currency)))) IS NOT 1 THEN RAISE(ABORT,'Payment allocations or net balance mismatch') END;
END;

CREATE TRIGGER "PaymentVoid_INSERT_guard" BEFORE INSERT ON "PaymentVoid" BEGIN
SELECT CASE WHEN (length(trim(NEW.reason)) BETWEEN 1 AND 500 AND length(NEW."recordedBy")>0) IS NOT 1 THEN RAISE(ABORT,'Invalid payment correction') END;
END;

CREATE TABLE "AuthChallenge" (id TEXT PRIMARY KEY, email TEXT NOT NULL, "codeHash" TEXT NOT NULL, "expiresAt" INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, "consumedAt" INTEGER, "createdAt" INTEGER NOT NULL);
CREATE INDEX "AuthChallenge_email_createdAt" ON "AuthChallenge"(email,"createdAt");
CREATE TABLE "AuthSession" ("tokenHash" TEXT PRIMARY KEY, subject TEXT NOT NULL, email TEXT NOT NULL, "verifiedAt" INTEGER NOT NULL, "expiresAt" INTEGER NOT NULL);
CREATE INDEX "AuthSession_expiry" ON "AuthSession"("expiresAt");
