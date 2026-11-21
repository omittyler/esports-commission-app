import db from "../../db.server";
import {
  requestCatchUp,
  discoverOrderUpdates,
  type DiscoveryGraphql,
} from "./catchup.server";
import { processInboxBatchDetailed } from "./inbox.server";
import type { reconcileOrder } from "./ingestion.server";
export type RefreshAdmin = {
  graphql: DiscoveryGraphql & Parameters<typeof reconcileOrder>[0];
};

/** One scheduled execution discovers a complete recent-order sweep and drains
 * ready reconciliation work. Deferred failures stay durable and exit nonzero. */
export async function refreshOrders(
  adminForShop: (shop: string) => Promise<RefreshAdmin>,
  options: { budgetMs?: number; stopping?: () => boolean } = {},
) {
  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) throw new Error("Configure SHOPIFY_SHOP before refreshing orders");
  const budget = options.budgetMs ?? 25 * 60000;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 3600000)
    throw new Error("Invalid refresh time budget");
  const start = performance.now();
  const stop = () =>
    options.stopping?.() || performance.now() - start >= budget;
  await requestCatchUp(shop);
  let processed = 0,
    queued = 0,
    complete = false;
  while (!stop()) {
    const scan = await discoverOrderUpdates(
      async (query, options) =>
        (await adminForShop(shop)).graphql(query, options),
      shop,
    );
    queued += scan.queued;
    if (["failed", "busy", "idle"].includes(scan.status)) break;
    const batch = await processInboxBatchDetailed(adminForShop);
    processed += batch.processed;
    if (scan.status === "complete") {
      // A scheduled full sweep may have been requested while resuming an
      // interrupted incremental scan. Complete that pending request as well.
      if (
        (await db.orderSyncState.findUniqueOrThrow({ where: { shop } }))
          .forceFull
      )
        continue;
      complete = true;
      break;
    }
  }
  if (complete)
    while (!stop()) {
      const batch = await processInboxBatchDetailed(adminForShop);
      processed += batch.processed;
      if (batch.attempted < 20) break;
    }
  const pending = await db.webhookDelivery.count({
    where: { shop, processedAt: null },
  });
  return { complete, queued, processed, pending, interrupted: !!stop() };
}
