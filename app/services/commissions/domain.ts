/** Currency amounts are already-normalized integer minor units. No Shopify DTOs here. */
export type Rate = {
  id: string;
  organizationId: string;
  rateBps: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};
export type Assignment = {
  id: string;
  organizationId: string;
  productGid: string;
  variantGid: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};
export type Line = {
  lineGid: string;
  productGid: string | null;
  variantGid: string | null;
  quantity: number;
  grossMinor: bigint;
  discountMinor: bigint;
};
export type Sale = {
  sourceKey: string;
  sourceRef: string;
  lineGid: string;
  organizationId: string;
  assignmentId: string;
  rateId: string;
  rateBps: number;
  baseMinor: bigint;
  commissionMinor: bigint;
  currency: string;
  occurredAt: Date;
};

export function validateDate(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid timestamp");
}
function activeAt(
  value: { effectiveFrom: Date; effectiveTo: Date | null },
  at: Date,
) {
  validateDate(value.effectiveFrom);
  if (value.effectiveTo) validateDate(value.effectiveTo);
  return (
    value.effectiveFrom <= at && (!value.effectiveTo || at < value.effectiveTo)
  );
}
function one<T>(values: T[], label: string): T | undefined {
  if (values.length > 1) throw new Error(`Conflicting ${label} history`);
  return values[0];
}
export function validateRate(rateBps: number) {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000)
    throw new Error(
      "Rate must be between 0 and 100 percent, with at most two decimal places",
    );
}
export function percentageToBps(value: string): number {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value))
    throw new Error("Enter a percentage with at most two decimal places");
  const [whole, fraction = ""] = value.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  validateRate(bps);
  return bps;
}
/** Round half up once per sale line. BigInt keeps large amounts exact. */
export function commission(baseMinor: bigint, rateBps: number): bigint {
  if (baseMinor < 0n) throw new Error("Base cannot be negative");
  validateRate(rateBps);
  return (baseMinor * BigInt(rateBps) + 5000n) / 10000n;
}
export function sourceKey(
  kind: "sale" | "refund",
  ref: string,
  lineGid: string,
): string {
  if (!ref || !lineGid)
    throw new Error("Stable source identifiers are required");
  return JSON.stringify([kind, ref, lineGid]);
}
export function calculateSales(input: {
  orderRef: string;
  occurredAt: Date;
  currency: string;
  lines: Line[];
  assignments: Assignment[];
  rates: Rate[];
}): Sale[] {
  validateDate(input.occurredAt);
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error("Invalid currency");
  const seen = new Set<string>();
  return input.lines.flatMap((line) => {
    if (!line.lineGid || seen.has(line.lineGid))
      throw new Error("Duplicate or missing line identifier");
    seen.add(line.lineGid);
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0 ||
      line.grossMinor < 0n ||
      line.discountMinor < 0n ||
      line.discountMinor > line.grossMinor
    )
      throw new Error("Invalid line amounts or quantity");
    const assignments = input.assignments.filter(
      (a) => a.productGid === line.productGid && activeAt(a, input.occurredAt),
    );
    const variant = one(
      assignments.filter(
        (a) => a.variantGid !== null && a.variantGid === line.variantGid,
      ),
      "variant assignment",
    );
    const assignment =
      variant ??
      one(
        assignments.filter((a) => a.variantGid === null),
        "product assignment",
      );
    if (!assignment) return [];
    const rate = one(
      input.rates.filter(
        (r) =>
          r.organizationId === assignment.organizationId &&
          activeAt(r, input.occurredAt),
      ),
      "commission rate",
    );
    if (!rate)
      throw new Error("Assigned organization has no rate at sale time");
    const baseMinor = line.grossMinor - line.discountMinor;
    return [
      {
        sourceKey: sourceKey("sale", input.orderRef, line.lineGid),
        sourceRef: input.orderRef,
        lineGid: line.lineGid,
        organizationId: assignment.organizationId,
        assignmentId: assignment.id,
        rateId: rate.id,
        rateBps: rate.rateBps,
        baseMinor,
        commissionMinor: commission(baseMinor, rate.rateBps),
        currency: input.currency,
        occurredAt: input.occurredAt,
      },
    ];
  });
}
/** Refund input is the discounted merchandise amount for this line, excluding shipping/tax.
 * Cumulative rounding guarantees all partial refunds together reverse exactly the original sale.
 */
export function calculateRefund(input: {
  sale: Sale;
  refundRef: string;
  occurredAt: Date;
  currency: string;
  refundMinor: bigint;
  alreadyRefundedMinor: bigint;
  alreadyReversedMinor: bigint;
}) {
  const { sale, refundMinor, alreadyRefundedMinor, alreadyReversedMinor } =
    input;
  validateDate(input.occurredAt);
  if (input.occurredAt < sale.occurredAt || input.currency !== sale.currency)
    throw new Error("Refund date or currency does not match sale");
  if (
    refundMinor <= 0n ||
    alreadyRefundedMinor < 0n ||
    alreadyReversedMinor < 0n ||
    sale.baseMinor <= 0n ||
    alreadyRefundedMinor + refundMinor > sale.baseMinor
  )
    throw new Error("Refund exceeds remaining merchandise base or is invalid");
  const rounded = (base: bigint) =>
    (sale.commissionMinor * base + sale.baseMinor / 2n) / sale.baseMinor;
  if (rounded(alreadyRefundedMinor) !== alreadyReversedMinor)
    throw new Error("Existing refund history is inconsistent");
  const target = rounded(alreadyRefundedMinor + refundMinor);
  return {
    ...sale,
    sourceKey: sourceKey("refund", input.refundRef, sale.lineGid),
    sourceRef: input.refundRef,
    occurredAt: input.occurredAt,
    baseMinor: -refundMinor,
    commissionMinor: -(target - alreadyReversedMinor),
  };
}
