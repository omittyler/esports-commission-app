ALTER TABLE "ProgramVersion" ADD CONSTRAINT valid_program_rule CHECK
  (currency ~ '^[A-Z]{3}$' AND ((kind = 'percentage' AND "rateBps" BETWEEN 0 AND 10000 AND "fixedMinor" IS NULL) OR (kind = 'fixed_item' AND "rateBps" = 0 AND "fixedMinor" >= 0 AND "fixedMinor" IS NOT NULL)));
CREATE TRIGGER program_version_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "ProgramVersion" FOR EACH STATEMENT EXECUTE FUNCTION deny_financial_mutation();
ALTER TABLE "AffiliateAccount" ADD CONSTRAINT valid_affiliate_profile CHECK
  ((type = 'organization' AND "organizationRole" IS NOT NULL AND length("organizationRole") > 0) OR (type = 'creator' AND "organizationRole" IS NULL));
ALTER TABLE "AffiliateAccount" ADD CONSTRAINT verified_approval CHECK
  (status <> 'approved' OR ("verifiedAt" IS NOT NULL AND "authSubject" IS NOT NULL AND "organizationId" IS NOT NULL));
ALTER TABLE "CommissionTransaction" ADD CONSTRAINT valid_rule_reference CHECK
  (("programVersionId" IS NULL AND "rateId" IS NOT NULL AND kind = 'percentage' AND "fixedMinor" IS NULL) OR ("programVersionId" IS NOT NULL AND "rateId" IS NULL));
ALTER TABLE "CommissionTransaction" ADD CONSTRAINT valid_refund_quantity CHECK
  ("refundedQuantity" >= 0 AND (type <> 'sale' OR "refundedQuantity" = 0));
ALTER TABLE "CommissionTransaction" DROP CONSTRAINT valid_transaction_sign;
ALTER TABLE "CommissionTransaction" ADD CONSTRAINT valid_transaction_sign CHECK
  ((type = 'sale' AND "baseMinor" >= 0 AND "commissionMinor" >= 0 AND "reversalOfId" IS NULL) OR
   (type = 'refund' AND "baseMinor" <= 0 AND "commissionMinor" <= 0 AND "reversalOfId" IS NOT NULL AND ("baseMinor" < 0 OR "refundedQuantity" > 0)));

CREATE OR REPLACE FUNCTION validate_ledger_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original "CommissionTransaction"%ROWTYPE;
  line "OrderLine"%ROWTYPE;
  assignment "ProductAssignment"%ROWTYPE;
  refunded numeric;
  reversed numeric;
  refunded_units bigint;
  target numeric;
BEGIN
  SELECT * INTO STRICT line FROM "OrderLine" WHERE id = NEW."orderLineId";
  IF (NEW."sourceKey"::jsonb)->>2 IS DISTINCT FROM line."lineGid" OR NEW."sourceRef" = '' THEN RAISE EXCEPTION 'Invalid financial event key'; END IF;
  IF line."orderId" <> NEW."orderId" OR line.currency <> NEW.currency OR line."organizationId" IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Ledger identity or currency mismatch'; END IF;
  IF NEW.type = 'sale' THEN
    SELECT * INTO STRICT assignment FROM "ProductAssignment" WHERE id = NEW."assignmentId";
    IF assignment."programVersionId" IS DISTINCT FROM NEW."programVersionId" THEN RAISE EXCEPTION 'Assignment program mismatch'; END IF;
    IF NEW."baseMinor" <> line."netMinor" THEN RAISE EXCEPTION 'Sale base mismatch'; END IF;
    IF NEW."programVersionId" IS NULL THEN
      IF NOT EXISTS (SELECT 1 FROM "CommissionRate" WHERE id = NEW."rateId" AND "organizationId" = NEW."organizationId" AND "rateBps" = NEW."rateBps" AND tstzrange("effectiveFrom", "effectiveTo", '[)') @> NEW."occurredAt") THEN RAISE EXCEPTION 'Sale rate snapshot mismatch'; END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM "ProgramVersion" WHERE id = NEW."programVersionId" AND kind = NEW.kind AND "rateBps" = NEW."rateBps" AND "fixedMinor" IS NOT DISTINCT FROM NEW."fixedMinor" AND currency = NEW.currency AND "createdAt" <= NEW."occurredAt") THEN RAISE EXCEPTION 'Program snapshot mismatch'; END IF;
    END IF;
    target := CASE WHEN NEW.kind = 'fixed_item' THEN LEAST(NEW."baseMinor"::numeric, NEW."fixedMinor"::numeric * line.quantity) ELSE floor((NEW."baseMinor"::numeric * NEW."rateBps" + 5000) / 10000) END;
    IF target IS NULL OR NEW."commissionMinor" <> target THEN RAISE EXCEPTION 'Invalid sale calculation'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "Order" WHERE id = NEW."orderId" AND "occurredAt" = NEW."occurredAt") THEN RAISE EXCEPTION 'Sale timestamp mismatch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ProductAssignment" WHERE id = NEW."assignmentId" AND "organizationId" = NEW."organizationId" AND "productGid" = line."productGid" AND ("variantGid" IS NULL OR "variantGid" = line."variantGid") AND tstzrange("effectiveFrom", "effectiveTo", '[)') @> NEW."occurredAt") THEN RAISE EXCEPTION 'Sale assignment snapshot mismatch'; END IF;
    IF EXISTS (SELECT 1 FROM "ProductAssignment" a WHERE assignment."variantGid" IS NULL AND a."productGid" = line."productGid" AND a."variantGid" = line."variantGid" AND tstzrange(a."effectiveFrom", a."effectiveTo", '[)') @> NEW."occurredAt") THEN RAISE EXCEPTION 'Variant assignment must take precedence'; END IF;
  ELSE
    SELECT * INTO STRICT original FROM "CommissionTransaction" WHERE id = NEW."reversalOfId" FOR UPDATE;
    IF original.type <> 'sale' OR original."orderLineId" <> NEW."orderLineId" OR original."rateId" IS DISTINCT FROM NEW."rateId" OR original."programVersionId" IS DISTINCT FROM NEW."programVersionId" OR original.kind <> NEW.kind OR original."fixedMinor" IS DISTINCT FROM NEW."fixedMinor" OR original."rateBps" <> NEW."rateBps" OR original."assignmentId" <> NEW."assignmentId" OR NEW."occurredAt" < original."occurredAt" THEN RAISE EXCEPTION 'Refund must use original snapshot'; END IF;
    SELECT COALESCE(-SUM("baseMinor"), 0), COALESCE(-SUM("commissionMinor"), 0), COALESCE(SUM("refundedQuantity"), 0) INTO refunded, reversed, refunded_units FROM "CommissionTransaction" WHERE "reversalOfId" = original.id;
    refunded := refunded - NEW."baseMinor";
    IF refunded_units + NEW."refundedQuantity" > line.quantity THEN RAISE EXCEPTION 'Excessive refund quantity'; END IF;
    IF original."baseMinor" < 0 OR refunded > original."baseMinor" THEN RAISE EXCEPTION 'Refund exceeds original merchandise base'; END IF;
    target := CASE WHEN original."baseMinor" = 0 THEN 0 ELSE floor((original."commissionMinor"::numeric * refunded + floor(original."baseMinor"::numeric / 2)) / original."baseMinor") END;
    IF NEW."commissionMinor" <> -(target - reversed) THEN RAISE EXCEPTION 'Invalid refund rounding'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
