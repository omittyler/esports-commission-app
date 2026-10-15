import { unauthenticated } from "../app/shopify.server";
import { processInboxBatch } from "../app/services/shopify/inbox.server";
import db from "../app/db.server";
import { discoverOrderUpdates } from "../app/services/shopify/catchup.server";
import { setTimeout } from "node:timers/promises";
const once = process.argv.includes("--once");
let stopping = false;
const sleep = new AbortController();
function stop() {
  stopping = true;
  sleep.abort();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  do {
    // --once retains its existing inbox-only contract. Use refresh:orders for
    // complete scheduled discovery and draining, including a daily NAS task.
    if (
      !once &&
      !stopping &&
      process.env.ORDER_SYNC_ENABLED !== "false" &&
      process.env.SHOPIFY_SHOP
    ) {
      try {
        const shop = process.env.SHOPIFY_SHOP;
        await discoverOrderUpdates(async (query, options) => {
          const { admin } = await unauthenticated.admin(shop);
          return admin.graphql(query, options);
        }, shop);
      } catch {
        console.warn(
          "Catch-up unavailable; check Order reporting and Shopify access.",
        );
      }
    }
    await processInboxBatch(async (shop) => {
      const { admin } = await unauthenticated.admin(shop);
      return { graphql: (query, options) => admin.graphql(query, options) };
    });
    if (!once && !stopping) {
      try {
        await setTimeout(10000, undefined, { signal: sleep.signal });
      } catch (error) {
        if (!sleep.signal.aborted) throw error;
      }
    }
  } while (!once && !stopping);
} finally {
  await db.$disconnect();
}
