import db from "../../db.server";
import { serializable } from "../admin.server";
import {
  calculateSales,
  calculateRefund,
  sourceKey,
  type Line,
  type Sale,
} from "./domain";

export type NormalizedOrder = {
  orderRef: string;
  displayName: string;
  occurredAt: Date;
  currency: string;
  lines: (Line & { title: string; sku?: string })[];
};
/** Not connected to live Shopify events in this pass. Atomic order/line/sale persistence. */
export async function recordOrder(input: NormalizedOrder) {
  if (input.currency !== process.env.SHOP_CURRENCY)
    throw new Error("Unexpected shop currency");
  return serializable(async (tx) => {
    const existing = await tx.order.findUnique({
      where: { shopifyOrderGid: input.orderRef },
      include: { lines: true, transactions: true },
    });
    if (existing) {
      const matches =
        existing.currency === input.currency &&
        existing.occurredAt.getTime() === input.occurredAt.getTime() &&
        existing.lines.length === input.lines.length &&
        input.lines.every((l) =>
          existing.lines.some(
            (e) =>
              e.lineGid === l.lineGid &&
              e.productGid === l.productGid &&
              e.variantGid === l.variantGid &&
              e.quantity === l.quantity &&
              e.grossMinor === l.grossMinor &&
              e.discountMinor === l.discountMinor,
          ),
        );
      if (!matches)
        throw new Error(
          "Order replay differs from recorded financial input; reconciliation is required",
        );
      return existing.transactions;
    }
    const [assignments, rates] = await Promise.all([
      tx.productAssignment.findMany(),
      tx.commissionRate.findMany(),
    ]);
    const sales = calculateSales({ ...input, assignments, rates });
    const order = await tx.order.create({
      data: {
        shopifyOrderGid: input.orderRef,
        displayName: input.displayName,
        occurredAt: input.occurredAt,
        currency: input.currency,
      },
    });
    const transactions = [];
    for (const line of input.lines) {
      const sale = sales.find((s) => s.lineGid === line.lineGid);
      const stored = await tx.orderLine.create({
        data: {
          orderId: order.id,
          lineGid: line.lineGid,
          productGid: line.productGid,
          variantGid: line.variantGid,
          sku: line.sku,
          title: line.title,
          quantity: line.quantity,
          grossMinor: line.grossMinor,
          discountMinor: line.discountMinor,
          netMinor: line.grossMinor - line.discountMinor,
          currency: input.currency,
          organizationId: sale?.organizationId,
        },
      });
      if (sale) {
        const data = ledgerData(sale);
        transactions.push(
          await tx.commissionTransaction.create({
            data: {
              ...data,
              orderId: order.id,
              orderLineId: stored.id,
              type: "sale",
            },
          }),
        );
      }
    }
    return transactions;
  });
}
export async function recordRefund(input: {
  saleId: string;
  refundRef: string;
  occurredAt: Date;
  currency: string;
  refundMinor: bigint;
}) {
  return serializable(async (tx) => {
    const original = await tx.commissionTransaction.findUniqueOrThrow({
      where: { id: input.saleId },
      include: { orderLine: true },
    });
    if (original.type !== "sale")
      throw new Error("Only sale entries can be reversed");
    const key = sourceKey(
      "refund",
      input.refundRef,
      original.orderLine.lineGid,
    );
    const existing = await tx.commissionTransaction.findUnique({
      where: { sourceKey: key },
    });
    if (existing) {
      if (
        existing.reversalOfId !== original.id ||
        existing.baseMinor !== -input.refundMinor ||
        existing.currency !== input.currency ||
        existing.occurredAt.getTime() !== input.occurredAt.getTime()
      )
        throw new Error("Refund replay differs from recorded input");
      return existing;
    }
    const reversals = await tx.commissionTransaction.findMany({
      where: { reversalOfId: original.id },
    });
    const sale: Sale = {
      ...ledgerData(original),
      lineGid: original.orderLine.lineGid,
    };
    const calculated = calculateRefund({
      ...input,
      sale,
      alreadyRefundedMinor: -reversals.reduce(
        (sum, r) => sum + r.baseMinor,
        0n,
      ),
      alreadyReversedMinor: -reversals.reduce(
        (sum, r) => sum + r.commissionMinor,
        0n,
      ),
    });
    const data = ledgerData(calculated);
    return tx.commissionTransaction.create({
      data: {
        ...data,
        type: "refund",
        orderId: original.orderId,
        orderLineId: original.orderLineId,
        reversalOfId: original.id,
      },
    });
  });
}
function ledgerData(sale: Omit<Sale, "lineGid">) {
  return {
    sourceKey: sale.sourceKey,
    sourceRef: sale.sourceRef,
    organizationId: sale.organizationId,
    assignmentId: sale.assignmentId,
    rateId: sale.rateId,
    rateBps: sale.rateBps,
    baseMinor: sale.baseMinor,
    commissionMinor: sale.commissionMinor,
    currency: sale.currency,
    occurredAt: sale.occurredAt,
  };
}
export async function organizationBalance(organizationId: string) {
  return db.commissionTransaction.aggregate({
    where: { organizationId },
    _sum: { baseMinor: true, commissionMinor: true },
  });
}
