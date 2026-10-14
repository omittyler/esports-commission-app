import { unauthenticated } from "../app/shopify.server";
import { processInboxBatch } from "../app/services/shopify/inbox.server";
import db from "../app/db.server";
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
