import { unauthenticated } from "../app/shopify.server";
import { refreshOrders } from "../app/services/shopify/refresh.server";
import db from "../app/db.server";
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
try {
  const result = await refreshOrders(
    async (shop) => {
      const { admin } = await unauthenticated.admin(shop);
      return { graphql: (query, options) => admin.graphql(query, options) };
    },
    { stopping: () => stopping },
  );
  console.log(
    `Order refresh: discovery ${result.complete ? "complete" : "incomplete"}; queued ${result.queued}; reconciled ${result.processed}; pending ${result.pending}.`,
  );
  if (!result.complete || result.pending || result.interrupted)
    process.exitCode = 1;
} catch {
  console.error(
    "Order refresh failed. Check the Order reporting page, Shopify access and database availability. No checkpoint was intentionally skipped.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
