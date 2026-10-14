import db from "../../db.server";
import { recordOrder, recordRefunds } from "../commissions/ledger.server";
import { amountToMinor } from "../money";
import {
  ORDER_QUERY,
  REFUND_QUERY,
  REFUND_ORDER_QUERY,
  normalizeOrder,
  type OrderLineDTO,
  type ShopMoney,
} from "./orders";
type Graphql = (
  query: string,
  options: { variables: { id: string; after?: string | null } },
) => Promise<Response>;
type Page<T> = {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};
type OrderDTO = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string;
  taxesIncluded: boolean;
  edited: boolean;
  dutiesIncluded: boolean;
  lineItems: Page<OrderLineDTO>;
  refunds: { id: string; createdAt: string }[];
};
type RefundDTO = {
  id: string;
  createdAt: string;
  transactions: {
    nodes: { kind: string; status: string }[];
    pageInfo: { hasNextPage: boolean };
  };
  refundLineItems: Page<{
    quantity: number;
    lineItem: { id: string };
    subtotalSet: { shopMoney: ShopMoney };
  }>;
};
async function requestData<T>(
  graphql: Graphql,
  query: string,
  variables: { id: string; after?: string | null },
): Promise<T> {
  const response = await graphql(query, { variables });
  const body = await response.json();
  if (!response.ok || body.errors || !body.data)
    throw new Error("Shopify order query failed; retry or reconcile");
  return body.data;
}
function nextCursor(page: Page<unknown>, seen: Set<string>) {
  if (!page.pageInfo.hasNextPage) return null;
  const cursor = page.pageInfo.endCursor;
  if (!cursor || seen.has(cursor))
    throw new Error("Incomplete Shopify pagination");
  seen.add(cursor);
  return cursor;
}
export async function reconcileOrder(graphql: Graphql, resourceGid: string) {
  let orderGid = resourceGid;
  if (resourceGid.startsWith("gid://shopify/Refund/")) {
    const result = await requestData<{
      refund: { order: { id: string } } | null;
    }>(graphql, REFUND_ORDER_QUERY, { id: resourceGid });
    if (!result.refund)
      throw new Error("Refund is unavailable for reconciliation");
    orderGid = result.refund.order.id;
  }
  let order: OrderDTO | null = null;
  const lines: OrderLineDTO[] = [];
  const cursors = new Set<string>();
  let after: string | null = null;
  do {
    const result = await requestData<{ order: OrderDTO | null }>(
      graphql,
      ORDER_QUERY,
      { id: orderGid, after },
    );
    if (!result.order)
      throw new Error("Order is unavailable; check order access window");
    order = result.order;
    lines.push(...order.lineItems.nodes);
    if (lines.length > 2000)
      throw new Error("Order too large for synchronous ingestion");
    after = nextCursor(order.lineItems, cursors);
  } while (after);
  if (
    !order ||
    !["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
      order.displayFinancialStatus,
    )
  )
    throw new Error("Order payment is not final yet");
  if (order.edited)
    throw new Error("Edited orders require manual reconciliation");
  if (order.dutiesIncluded)
    throw new Error("Duty-inclusive orders require reviewed normalization");
  const refundInputs: {
    refundRef: string;
    lineGid: string;
    occurredAt: Date;
    currency: string;
    refundMinor: bigint;
    refundedQuantity: number;
  }[] = [];
  // Fetch complete financial inputs before posting. No partial order from truncation/failure.
  for (const reference of order.refunds.sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )) {
    after = null;
    cursors.clear();
    const grouped = new Map<string, { amount: bigint; quantity: number }>();
    let paymentFinal = false;
    do {
      const result = await requestData<{ refund: RefundDTO | null }>(
        graphql,
        REFUND_QUERY,
        { id: reference.id, after },
      );
      const refund = result.refund;
      if (!refund) throw new Error("Refund is unavailable for reconciliation");
      if (refund.transactions.pageInfo.hasNextPage)
        throw new Error(
          "Incomplete refund payment history requires manual reconciliation",
        );
      const payments = refund.transactions.nodes.filter(
        (t) => t.kind === "REFUND",
      );
      paymentFinal =
        payments.length > 0 && payments.every((t) => t.status === "SUCCESS");
      for (const line of refund.refundLineItems.nodes) {
        const money = line.subtotalSet.shopMoney;
        if (money.currencyCode !== process.env.SHOP_CURRENCY)
          throw new Error("Refund currency mismatch");
        const previous = grouped.get(line.lineItem.id) ?? {
          amount: 0n,
          quantity: 0,
        };
        previous.amount += amountToMinor(money.amount, money.currencyCode);
        previous.quantity += line.quantity;
        grouped.set(line.lineItem.id, previous);
      }
      if (grouped.size > 2000)
        throw new Error("Refund too large for synchronous ingestion");
      after = nextCursor(refund.refundLineItems, cursors);
    } while (after);
    if ([...grouped.values()].some((line) => line.amount > 0n) && !paymentFinal)
      throw new Error(
        "Refund payment is not completed; retry for reconciliation",
      );
    for (const [lineGid, line] of grouped)
      if (line.amount > 0n || line.quantity > 0)
        refundInputs.push({
          refundRef: reference.id,
          lineGid,
          occurredAt: new Date(reference.createdAt),
          currency: process.env.SHOP_CURRENCY!,
          refundMinor: line.amount,
          refundedQuantity: line.quantity,
        });
  }
  for (const line of lines) {
    if (!line.isGiftCard && (!line.product || !line.variant))
      throw new Error(
        "Missing catalog identity requires manual attribution review",
      );
    const refunded = refundInputs.filter((r) => r.lineGid === line.id);
    const units = refunded.reduce((sum, r) => sum + r.refundedQuantity, 0);
    if (
      !Number.isSafeInteger(line.currentQuantity) ||
      line.quantity !== line.currentQuantity + units
    )
      throw new Error("Edited order quantities require manual reconciliation");
    const base =
      amountToMinor(
        line.originalTotalSet.shopMoney.amount,
        process.env.SHOP_CURRENCY!,
      ) -
      line.discountAllocations.reduce(
        (sum, d) =>
          sum +
          amountToMinor(
            d.allocatedAmountSet.shopMoney.amount,
            process.env.SHOP_CURRENCY!,
          ),
        0n,
      );
    if (refunded.reduce((sum, r) => sum + r.refundMinor, 0n) > base)
      throw new Error("Refund exceeds discounted merchandise revenue");
  }
  const sales = await recordOrder(
    normalizeOrder({ ...order, lines }, process.env.SHOP_CURRENCY!),
  );
  // Find by stable line identity; generic lines deliberately have no sale entry.
  const storedSales = await db.commissionTransaction.findMany({
    where: { sourceRef: orderGid, type: "sale" },
    include: { orderLine: { select: { lineGid: true } } },
  });
  await recordRefunds(
    refundInputs.flatMap((input) => {
      const sale = storedSales.find(
        (s) => s.orderLine.lineGid === input.lineGid,
      );
      return sale ? [{ ...input, saleId: sale.id }] : [];
    }),
  );
  return { orderGid, sales: sales.length };
}
