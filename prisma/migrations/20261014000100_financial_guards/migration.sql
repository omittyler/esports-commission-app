CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "CommissionRate" ADD CONSTRAINT "valid_rate" CHECK ("rateBps" BETWEEN 0 AND 10000);
ALTER TABLE "CommissionRate" ADD CONSTRAINT "valid_rate_period" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE "CommissionRate" ADD CONSTRAINT "rate_no_overlap" EXCLUDE USING gist
  ("organizationId" WITH =, tstzrange("effectiveFrom", "effectiveTo", '[)') WITH &&);
ALTER TABLE "ProductAssignment" ADD CONSTRAINT "valid_assignment_period" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE "ProductAssignment" ADD CONSTRAINT "assignment_no_overlap" EXCLUDE USING gist
  ("productGid" WITH =, (COALESCE("variantGid", '')) WITH =, tstzrange("effectiveFrom", "effectiveTo", '[)') WITH &&);
ALTER TABLE "ProductAssignment" ADD CONSTRAINT "valid_assignment_gid" CHECK
  ("productGid" ~ '^gid://shopify/Product/[0-9]+$' AND ("variantGid" IS NULL OR "variantGid" ~ '^gid://shopify/ProductVariant/[0-9]+$'));
ALTER TABLE "Order" ADD CONSTRAINT "valid_order_currency" CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE "OrderLine" ADD CONSTRAINT "valid_line_amounts" CHECK
  (quantity > 0 AND "grossMinor" >= 0 AND "discountMinor" >= 0 AND "discountMinor" <= "grossMinor" AND "netMinor" = "grossMinor" - "discountMinor");
ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "valid_transaction_rate" CHECK ("rateBps" BETWEEN 0 AND 10000);
ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "valid_transaction_sign" CHECK
  ((type = 'sale' AND "baseMinor" >= 0 AND "commissionMinor" >= 0 AND "reversalOfId" IS NULL)
   OR (type = 'refund' AND "baseMinor" < 0 AND "commissionMinor" <= 0 AND "reversalOfId" IS NOT NULL));
CREATE UNIQUE INDEX "one_sale_per_line" ON "CommissionTransaction" ("orderLineId") WHERE type = 'sale';
CREATE UNIQUE INDEX "one_event_per_line" ON "CommissionTransaction" (type, "sourceRef", "orderLineId");
ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "canonical_source_key" CHECK
  ("sourceKey"::jsonb = jsonb_build_array(type::text, "sourceRef", ("sourceKey"::jsonb)->>2) AND jsonb_array_length("sourceKey"::jsonb) = 3);

CREATE FUNCTION deny_financial_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Financial and audit records are append-only'; END;
$$;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "CommissionTransaction" FOR EACH STATEMENT EXECUTE FUNCTION deny_financial_mutation();
CREATE TRIGGER order_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "Order" FOR EACH STATEMENT EXECUTE FUNCTION deny_financial_mutation();
CREATE TRIGGER line_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "OrderLine" FOR EACH STATEMENT EXECUTE FUNCTION deny_financial_mutation();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "AuditEvent" FOR EACH STATEMENT EXECUTE FUNCTION deny_financial_mutation();

CREATE FUNCTION protect_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'History cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - 'effectiveTo') IS DISTINCT FROM (to_jsonb(OLD) - 'effectiveTo') THEN
    RAISE EXCEPTION 'Historical attribution and rates cannot be edited';
  END IF;
  IF NEW."effectiveTo" IS NULL OR NEW."effectiveTo" < date_trunc('milliseconds', transaction_timestamp()) OR
    (OLD."effectiveTo" IS NOT NULL AND NEW."effectiveTo" > OLD."effectiveTo") THEN
    RAISE EXCEPTION 'History can only be closed prospectively';
  END IF;
  IF TG_TABLE_NAME = 'CommissionRate' THEN
    IF EXISTS (SELECT 1 FROM "CommissionTransaction" WHERE "rateId" = OLD.id AND type = 'sale' AND "occurredAt" >= NEW."effectiveTo") THEN
      RAISE EXCEPTION 'Rate interval contains posted transactions';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM "CommissionTransaction" WHERE "assignmentId" = OLD.id AND type = 'sale' AND "occurredAt" >= NEW."effectiveTo") THEN
      RAISE EXCEPTION 'Assignment interval contains posted transactions';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rate_history_guard BEFORE UPDATE OR DELETE ON "CommissionRate" FOR EACH ROW EXECUTE FUNCTION protect_history();
CREATE TRIGGER assignment_history_guard BEFORE UPDATE OR DELETE ON "ProductAssignment" FOR EACH ROW EXECUTE FUNCTION protect_history();
CREATE TRIGGER rate_no_truncate BEFORE TRUNCATE ON "CommissionRate" FOR EACH STATEMENT EXECUTE FUNCTION deny_financial_mutation();
CREATE TRIGGER assignment_no_truncate BEFORE TRUNCATE ON "ProductAssignment" FOR EACH STATEMENT EXECUTE FUNCTION deny_financial_mutation();

CREATE FUNCTION validate_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Order" WHERE id = NEW."orderId" AND currency = NEW.currency) THEN RAISE EXCEPTION 'Line currency mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER line_currency BEFORE INSERT ON "OrderLine" FOR EACH ROW EXECUTE FUNCTION validate_line();

CREATE FUNCTION validate_ledger_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original "CommissionTransaction"%ROWTYPE;
  line "OrderLine"%ROWTYPE;
  refunded numeric;
  reversed numeric;
  target numeric;
BEGIN
  SELECT * INTO STRICT line FROM "OrderLine" WHERE id = NEW."orderLineId";
  IF (NEW."sourceKey"::jsonb)->>2 IS DISTINCT FROM line."lineGid" OR NEW."sourceRef" = '' THEN RAISE EXCEPTION 'Invalid financial event key'; END IF;
  IF line."orderId" <> NEW."orderId" OR line.currency <> NEW.currency OR line."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'Ledger line, organization, order or currency mismatch';
  END IF;
  IF NEW.type = 'sale' THEN
    IF NEW."baseMinor" <> line."netMinor" OR NEW."commissionMinor" <> floor((NEW."baseMinor"::numeric * NEW."rateBps" + 5000) / 10000) THEN
      RAISE EXCEPTION 'Invalid sale calculation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "Order" WHERE id = NEW."orderId" AND "occurredAt" = NEW."occurredAt") THEN RAISE EXCEPTION 'Sale timestamp mismatch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "CommissionRate" WHERE id = NEW."rateId" AND "organizationId" = NEW."organizationId" AND "rateBps" = NEW."rateBps" AND tstzrange("effectiveFrom", "effectiveTo", '[)') @> NEW."occurredAt") THEN
      RAISE EXCEPTION 'Sale rate snapshot mismatch';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "ProductAssignment" WHERE id = NEW."assignmentId" AND "organizationId" = NEW."organizationId" AND "productGid" = line."productGid" AND ("variantGid" IS NULL OR "variantGid" = line."variantGid") AND tstzrange("effectiveFrom", "effectiveTo", '[)') @> NEW."occurredAt") THEN
      RAISE EXCEPTION 'Sale assignment snapshot mismatch';
    END IF;
    IF EXISTS (SELECT 1 FROM "ProductAssignment" a JOIN "ProductAssignment" selected ON selected.id = NEW."assignmentId" WHERE selected."variantGid" IS NULL AND a."productGid" = line."productGid" AND a."variantGid" = line."variantGid" AND tstzrange(a."effectiveFrom", a."effectiveTo", '[)') @> NEW."occurredAt") THEN RAISE EXCEPTION 'Variant assignment must take precedence'; END IF;
  ELSE
    SELECT * INTO STRICT original FROM "CommissionTransaction" WHERE id = NEW."reversalOfId" FOR UPDATE;
    IF original.type <> 'sale' OR original."orderLineId" <> NEW."orderLineId" OR original."rateId" <> NEW."rateId" OR original."rateBps" <> NEW."rateBps" OR original."assignmentId" <> NEW."assignmentId" OR NEW."occurredAt" < original."occurredAt" THEN
      RAISE EXCEPTION 'Refund must use original sale snapshot';
    END IF;
    SELECT COALESCE(-SUM("baseMinor"), 0), COALESCE(-SUM("commissionMinor"), 0) INTO refunded, reversed FROM "CommissionTransaction" WHERE "reversalOfId" = original.id;
    refunded := refunded - NEW."baseMinor";
    IF original."baseMinor" <= 0 OR refunded > original."baseMinor" THEN RAISE EXCEPTION 'Refund exceeds original merchandise base'; END IF;
    target := floor((original."commissionMinor"::numeric * refunded + floor(original."baseMinor"::numeric / 2)) / original."baseMinor");
    IF NEW."commissionMinor" <> -(target - reversed) THEN RAISE EXCEPTION 'Refund rounding does not conserve original commission'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_financial_guard BEFORE INSERT ON "CommissionTransaction" FOR EACH ROW EXECUTE FUNCTION validate_ledger_insert();
