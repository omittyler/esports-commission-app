import { amountToMinor } from "../money";
import type { NormalizedOrder } from "../commissions/ledger.server";
export const ORDER_QUERY = `#graphql
  query CommissionOrder($id: ID!, $after: String) {
    order(id: $id) {
      id name createdAt displayFinancialStatus taxesIncluded edited dutiesIncluded
      lineItems(first: 100, after: $after) {
        nodes {
          id name sku quantity currentQuantity isGiftCard product { id } variant { id }
          originalTotalSet { shopMoney { amount currencyCode } }
          discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
        }
        pageInfo { hasNextPage endCursor }
      }
      refunds { id createdAt }
    }
  }
`;
export const REFUND_QUERY = `#graphql
  query CommissionRefund($id: ID!, $after: String) {
    refund(id: $id) {
      id createdAt
      transactions(first: 100) { nodes { kind status } pageInfo { hasNextPage } }
      refundLineItems(first: 100, after: $after) {
        nodes { quantity lineItem { id } subtotalSet { shopMoney { amount currencyCode } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;
export type ShopMoney = { amount: string; currencyCode: string };
export type OrderLineDTO = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  currentQuantity: number;
  isGiftCard: boolean;
  product: { id: string } | null;
  variant: { id: string } | null;
  originalTotalSet: { shopMoney: ShopMoney };
  discountAllocations: { allocatedAmountSet: { shopMoney: ShopMoney } }[];
};
export function normalizeOrder(
  input: {
    id: string;
    name: string;
    createdAt: string;
    taxesIncluded?: boolean;
    lines: OrderLineDTO[];
  },
  currency: string,
): NormalizedOrder {
  if (input.taxesIncluded)
    throw new Error("Tax-inclusive orders require reviewed tax normalization");
  const money = (m: ShopMoney) => {
    if (m.currencyCode !== currency) throw new Error("Shop currency mismatch");
    return amountToMinor(m.amount, currency);
  };
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(input.id))
    throw new Error("Invalid order identifier");
  return {
    orderRef: input.id,
    displayName: input.name,
    occurredAt: new Date(input.createdAt),
    currency,
    lines: input.lines.map((l) => ({
      lineGid: l.id,
      productGid: l.product?.id ?? null,
      variantGid: l.variant?.id ?? null,
      title: l.name,
      sku: l.sku ?? undefined,
      quantity: l.quantity,
      eligible: !l.isGiftCard,
      grossMinor: money(l.originalTotalSet.shopMoney),
      discountMinor: l.discountAllocations.reduce(
        (sum, d) => sum + money(d.allocatedAmountSet.shopMoney),
        0n,
      ),
    })),
  };
}
export function webhookResource(
  topic: string,
  payload: Record<string, unknown>,
): string {
  if (topic === "ORDERS_PAID") {
    if (
      typeof payload.admin_graphql_api_id !== "string" ||
      !/^gid:\/\/shopify\/Order\/\d+$/.test(payload.admin_graphql_api_id)
    )
      throw new Error("Missing order GID");
    return payload.admin_graphql_api_id;
  }
  if (topic !== "REFUNDS_CREATE") throw new Error("Unexpected webhook topic");
  // Never parse numeric JSON IDs through Number, which can lose 64-bit precision.
  if (typeof payload.order_id === "string" && /^\d+$/.test(payload.order_id))
    return `gid://shopify/Order/${payload.order_id}`;
  if (
    typeof payload.order_id === "number" &&
    Number.isSafeInteger(payload.order_id) &&
    payload.order_id > 0
  )
    return `gid://shopify/Order/${payload.order_id}`;
  // For unsafe order_id, resolve the exact order via the refund's stable GraphQL GID.
  if (
    typeof payload.admin_graphql_api_id === "string" &&
    /^gid:\/\/shopify\/Refund\/\d+$/.test(payload.admin_graphql_api_id)
  )
    return payload.admin_graphql_api_id;
  throw new Error("Missing safe refund/order identifier");
}
export const REFUND_ORDER_QUERY = `#graphql
  query RefundOrder($id: ID!) { refund(id: $id) { order { id } } }
`;
