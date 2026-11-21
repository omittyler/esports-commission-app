export const ORDER_UPDATES_QUERY = `#graphql
  query CommissionOrderUpdates($query: String!, $after: String) {
    orders(first: 100, after: $after, query: $query, sortKey: UPDATED_AT, reverse: false) {
      nodes { id createdAt updatedAt displayFinancialStatus }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
export const DAY_MS = 86400000;
export const SYNC_LEASE_MS = 600000;
export const SAFE_LOOKBACK_MS = 59 * DAY_MS;
export const SYNC_LAG_MS = 5 * 60000;
export const SYNC_ERROR =
  "Catch-up scan failed. Check Shopify access, API availability and pagination; the saved checkpoint has not advanced.";

export function syncIntervalMs(
  value = process.env.ORDER_SYNC_INTERVAL_SECONDS,
) {
  if (value === undefined || value === "") return 3600000;
  if (!/^\d+$/.test(value) || Number(value) < 300 || Number(value) > 86400)
    throw new Error(
      "ORDER_SYNC_INTERVAL_SECONDS must be between 300 and 86400",
    );
  return Number(value) * 1000;
}
export function scanWindow(
  now: Date,
  completedThrough: Date | null,
  lastFullScanAt: Date | null,
  forceFull: boolean,
) {
  const creationFloor = new Date(now.getTime() - SAFE_LOOKBACK_MS);
  const windowTo = new Date(now.getTime() - SYNC_LAG_MS);
  if (completedThrough && completedThrough > now)
    throw new Error("Catch-up checkpoint is in the future");
  const fullSweep =
    forceFull ||
    !completedThrough ||
    !lastFullScanAt ||
    now.getTime() - lastFullScanAt.getTime() >= DAY_MS;
  const windowFrom = new Date(
    fullSweep
      ? creationFloor.getTime()
      : Math.max(creationFloor.getTime(), completedThrough!.getTime() - DAY_MS),
  );
  return {
    windowFrom,
    windowTo,
    creationFloor,
    fullSweep,
    gap:
      completedThrough && completedThrough < creationFloor
        ? { from: completedThrough, to: creationFloor }
        : null,
  };
}
export function orderSearch(window: {
  windowFrom: Date;
  windowTo: Date;
  creationFloor: Date;
}) {
  return `created_at:>='${window.creationFloor.toISOString()}' updated_at:>='${window.windowFrom.toISOString()}' updated_at:<'${window.windowTo.toISOString()}' (financial_status:paid OR financial_status:partially_refunded OR financial_status:refunded)`;
}
export type DiscoveredOrder = {
  id: string;
  createdAt: string;
  updatedAt: string;
  displayFinancialStatus: string;
};
export type DiscoveryPage = {
  nodes: DiscoveredOrder[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};
export function validateDiscoveryPage(
  page: DiscoveryPage,
  window: {
    windowFrom: Date;
    windowTo: Date;
    creationFloor: Date;
    cursorHistory: string[];
  },
) {
  if (
    !page ||
    !Array.isArray(page.nodes) ||
    page.nodes.length > 100 ||
    !page.pageInfo ||
    typeof page.pageInfo.hasNextPage !== "boolean"
  )
    throw new Error("Invalid discovery page");
  const seen = new Set<string>();
  for (const node of page.nodes) {
    const created = new Date(node.createdAt),
      updated = new Date(node.updatedAt);
    if (
      !/^gid:\/\/shopify\/Order\/\d+$/.test(node.id) ||
      seen.has(node.id) ||
      !Number.isFinite(created.getTime()) ||
      !Number.isFinite(updated.getTime()) ||
      created < window.creationFloor ||
      created > updated ||
      updated < window.windowFrom ||
      updated >= window.windowTo ||
      !["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
        node.displayFinancialStatus,
      )
    )
      throw new Error(
        "Order discovery differs from the bounded financial query",
      );
    seen.add(node.id);
  }
  const cursor = page.pageInfo.endCursor;
  if (
    page.pageInfo.hasNextPage &&
    (!page.nodes.length ||
      typeof cursor !== "string" ||
      !cursor ||
      window.cursorHistory.includes(cursor))
  )
    throw new Error("Incomplete or repeated discovery cursor");
  if (cursor && cursor.length > 4000)
    throw new Error("Invalid discovery cursor");
  return page.pageInfo.hasNextPage ? cursor : null;
}
