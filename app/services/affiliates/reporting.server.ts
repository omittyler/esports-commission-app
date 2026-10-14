import db from "../../db.server";
import { formatMinor } from "../money";
export async function affiliateReport(organizationId: string) {
  const [assignments, entries, snapshots] = await Promise.all([
    db.productAssignment.findMany({
      where: { organizationId },
      include: { programVersion: true },
      orderBy: { effectiveFrom: "desc" },
    }),
    db.commissionTransaction.findMany({
      where: { organizationId },
      include: {
        order: { select: { displayName: true, occurredAt: true } },
        orderLine: {
          select: {
            productGid: true,
            variantGid: true,
            title: true,
            quantity: true,
          },
        },
      },
      orderBy: { occurredAt: "desc" },
    }),
    db.auditEvent.findMany({
      where: {
        entityId: organizationId,
        action: "assignment.collection_snapshot",
      },
      select: { metadata: true },
    }),
  ]);
  const collections = new Map<string, string>();
  for (const snapshot of snapshots) {
    const value = snapshot.metadata;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.collectionTitle === "string" &&
      Array.isArray(value.assignmentIds)
    )
      for (const id of value.assignmentIds)
        if (typeof id === "string") collections.set(id, value.collectionTitle);
  }
  const products = new Map<
    string,
    {
      title: string;
      currency: string;
      sold: number;
      refunded: number;
      base: bigint;
      commission: bigint;
    }
  >();
  const orders = new Map<
    string,
    {
      name: string;
      date: string;
      currency: string;
      base: bigint;
      commission: bigint;
      products: Set<string>;
      sold: number;
      refunded: number;
    }
  >();
  const totals = new Map<
    string,
    { base: bigint; commission: bigint; sold: number; refunded: number }
  >();
  for (const e of entries) {
    const productKey = JSON.stringify([
      e.orderLine.productGid,
      e.orderLine.variantGid,
      e.currency,
    ]);
    const p = products.get(productKey) ?? {
      title: e.orderLine.title,
      currency: e.currency,
      sold: 0,
      refunded: 0,
      base: 0n,
      commission: 0n,
    };
    p.sold += e.type === "sale" ? e.orderLine.quantity : 0;
    p.refunded += e.refundedQuantity;
    p.base += e.baseMinor;
    p.commission += e.commissionMinor;
    products.set(productKey, p);
    const o = orders.get(e.orderId) ?? {
      name: e.order.displayName,
      date: e.order.occurredAt.toISOString(),
      currency: e.currency,
      base: 0n,
      commission: 0n,
      products: new Set<string>(),
      sold: 0,
      refunded: 0,
    };
    o.base += e.baseMinor;
    o.commission += e.commissionMinor;
    o.products.add(e.orderLine.title);
    o.sold += e.type === "sale" ? e.orderLine.quantity : 0;
    o.refunded += e.refundedQuantity;
    orders.set(e.orderId, o);
    const t = totals.get(e.currency) ?? {
      base: 0n,
      commission: 0n,
      sold: 0,
      refunded: 0,
    };
    t.base += e.baseMinor;
    t.commission += e.commissionMinor;
    t.sold += e.type === "sale" ? e.orderLine.quantity : 0;
    t.refunded += e.refundedQuantity;
    totals.set(e.currency, t);
  }
  return {
    assignments: assignments.map((a) => ({
      id: a.id,
      title: a.displayTitle,
      variant: !!a.variantGid,
      from: a.effectiveFrom.toISOString(),
      to: a.effectiveTo?.toISOString() ?? null,
      collection: collections.get(a.id) ?? null,
      program: a.programVersion
        ? `${a.programVersion.label} · ${a.programVersion.kind === "percentage" ? `${a.programVersion.rateBps / 100}%` : `${formatMinor(a.programVersion.fixedMinor!, a.programVersion.currency)} per item`}`
        : "Organization rate",
    })),
    totals: [...totals].map(([currency, t]) => ({
      currency,
      ...t,
      base: t.base.toString(),
      commission: t.commission.toString(),
    })),
    products: [...products].map(([key, p]) => ({
      key,
      ...p,
      base: p.base.toString(),
      commission: p.commission.toString(),
    })),
    orders: [...orders].map(([key, o]) => ({
      key,
      ...o,
      products: [...o.products],
      base: o.base.toString(),
      commission: o.commission.toString(),
    })),
    ledger: entries.map((e) => ({
      id: e.id,
      type: e.type,
      order: e.order.displayName,
      product: e.orderLine.title,
      date: e.occurredAt.toISOString(),
      base: e.baseMinor.toString(),
      commission: e.commissionMinor.toString(),
      currency: e.currency,
    })),
  };
}
