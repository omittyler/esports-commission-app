import { unauthenticated } from "../app/shopify.server";
import { processInboxBatch } from "../app/services/shopify/inbox.server";
const once = process.argv.includes("--once");
do {
  await processInboxBatch(async (shop) => {
    const { admin } = await unauthenticated.admin(shop);
    return { graphql: (query, options) => admin.graphql(query, options) };
  });
  if (!once) await new Promise((resolve) => setTimeout(resolve, 10000));
} while (!once);
