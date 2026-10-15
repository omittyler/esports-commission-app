CREATE TABLE "CommissionPayment" (
  id uuid PRIMARY KEY, "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT,
  "amountMinor" bigint NOT NULL CHECK ("amountMinor" > 0), currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  "paidAt" timestamptz(3) NOT NULL, method text NOT NULL CHECK (method IN ('paypal','bank','other')),
  reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 120),
  "referenceKey" text NOT NULL UNIQUE,
  "idempotencyKey" uuid NOT NULL UNIQUE,
  "payeeEmail" text NOT NULL CHECK (length("payeeEmail") > 0),
  "recordedBy" text NOT NULL CHECK (length("recordedBy") > 0),
  "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payment_reference_key CHECK ("referenceKey" = method || ':' || lower(reference)),
  CONSTRAINT payment_date CHECK ("paidAt" <= CURRENT_TIMESTAMP)
);
CREATE INDEX "CommissionPayment_organizationId_paidAt_idx" ON "CommissionPayment"("organizationId", "paidAt");
CREATE TABLE "PaymentAllocation" (
  id uuid PRIMARY KEY, "paymentId" uuid NOT NULL REFERENCES "CommissionPayment"(id) ON DELETE RESTRICT,
  "transactionId" uuid NOT NULL REFERENCES "CommissionTransaction"(id) ON DELETE RESTRICT,
  "amountMinor" bigint NOT NULL CHECK ("amountMinor" <> 0),
  UNIQUE ("paymentId", "transactionId")
);
CREATE INDEX "PaymentAllocation_transactionId_idx" ON "PaymentAllocation"("transactionId");
CREATE TABLE "PaymentVoid" (
  id uuid PRIMARY KEY, "paymentId" uuid NOT NULL UNIQUE REFERENCES "CommissionPayment"(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  "recordedBy" text NOT NULL CHECK (length("recordedBy") > 0),
  "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER payment_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "CommissionPayment" FOR EACH STATEMENT EXECUTE FUNCTION deny_financial_mutation();
CREATE TRIGGER allocation_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "PaymentAllocation" FOR EACH STATEMENT EXECUTE FUNCTION deny_financial_mutation();
CREATE TRIGGER payment_void_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "PaymentVoid" FOR EACH STATEMENT EXECUTE FUNCTION deny_financial_mutation();

CREATE FUNCTION validate_payment_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment "CommissionPayment"%ROWTYPE; entry "CommissionTransaction"%ROWTYPE; allocated numeric;
BEGIN
  SELECT * INTO STRICT payment FROM "CommissionPayment" WHERE id = NEW."paymentId";
  PERFORM id FROM "Organization" WHERE id = payment."organizationId" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "PaymentVoid" WHERE "paymentId" = payment.id) THEN RAISE EXCEPTION 'Cannot allocate a void payment'; END IF;
  SELECT * INTO STRICT entry FROM "CommissionTransaction" WHERE id = NEW."transactionId";
  IF payment."organizationId" <> entry."organizationId" OR payment.currency <> entry.currency THEN RAISE EXCEPTION 'Payment allocation identity or currency mismatch'; END IF;
  SELECT COALESCE(SUM(a."amountMinor"),0) INTO allocated FROM "PaymentAllocation" a
    WHERE a."transactionId" = entry.id AND NOT EXISTS (SELECT 1 FROM "PaymentVoid" v WHERE v."paymentId" = a."paymentId");
  allocated := allocated + NEW."amountMinor";
  IF (entry."commissionMinor" >= 0 AND (NEW."amountMinor" <= 0 OR allocated > entry."commissionMinor")) OR
     (entry."commissionMinor" < 0 AND (NEW."amountMinor" >= 0 OR allocated < entry."commissionMinor")) THEN
    RAISE EXCEPTION 'Payment exceeds unallocated commission or refund credit';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_allocation_guard BEFORE INSERT ON "PaymentAllocation" FOR EACH ROW EXECUTE FUNCTION validate_payment_allocation();

-- A payment and its allocations must commit together. This also protects callers
-- that bypass the service from spending gross commissions without refund credits.
CREATE FUNCTION validate_payment_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment "CommissionPayment"%ROWTYPE; allocated numeric; earned numeric; paid numeric; payment_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'CommissionPayment' THEN payment_id := NEW.id; ELSE payment_id := NEW."paymentId"; END IF;
  SELECT * INTO STRICT payment FROM "CommissionPayment" WHERE id = payment_id;
  PERFORM id FROM "Organization" WHERE id = payment."organizationId" FOR UPDATE;
  SELECT COALESCE(SUM("amountMinor"),0) INTO allocated FROM "PaymentAllocation" WHERE "paymentId" = payment.id;
  IF allocated <> payment."amountMinor" THEN RAISE EXCEPTION 'Payment allocations must equal transferred amount'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "PaymentVoid" WHERE "paymentId" = payment.id) THEN
    SELECT COALESCE(SUM("commissionMinor"),0) INTO earned FROM "CommissionTransaction" WHERE "organizationId" = payment."organizationId" AND currency = payment.currency;
    SELECT COALESCE(SUM(p."amountMinor"),0) INTO paid FROM "CommissionPayment" p WHERE p."organizationId" = payment."organizationId" AND p.currency = payment.currency AND NOT EXISTS (SELECT 1 FROM "PaymentVoid" v WHERE v."paymentId" = p.id);
    IF paid > earned THEN RAISE EXCEPTION 'Payment exceeds net outstanding commission'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER payment_balanced AFTER INSERT ON "CommissionPayment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_payment_balance();
CREATE CONSTRAINT TRIGGER allocation_balanced AFTER INSERT ON "PaymentAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_payment_balance();

CREATE FUNCTION lock_payment_void() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM o.id FROM "Organization" o JOIN "CommissionPayment" p ON p."organizationId" = o.id WHERE p.id = NEW."paymentId" FOR UPDATE OF o;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_void_lock BEFORE INSERT ON "PaymentVoid" FOR EACH ROW EXECUTE FUNCTION lock_payment_void();

CREATE FUNCTION validate_payment_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM "Organization" WHERE id = NEW."organizationId" FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM "AffiliateAccount" WHERE "organizationId" = NEW."organizationId" AND status = 'approved' AND "verifiedAt" IS NOT NULL AND "paypalEmail" = NEW."payeeEmail") THEN
    RAISE EXCEPTION 'Payment requires an approved affiliate and payee snapshot';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_identity_guard BEFORE INSERT ON "CommissionPayment" FOR EACH ROW EXECUTE FUNCTION validate_payment_insert();
