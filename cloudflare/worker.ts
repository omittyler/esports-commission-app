import { createRequestHandler } from "react-router";
import type {
  D1Database,
  ExecutionContext,
  ScheduledController,
} from "@cloudflare/workers-types";
import { withDatabase, databaseContext } from "./database.server";
import { unauthenticated } from "./shopify.server";
import { discoverOrderUpdates } from "../app/services/shopify/catchup.server";
import { processInboxBatchDetailed } from "../app/services/shopify/inbox.server";
export type Env = { DB: D1Database };
// Resolved by React Router's Vite plugin, not the filesystem resolver.
const handler = createRequestHandler(
  // eslint-disable-next-line import/no-unresolved
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);
async function ready(env: Env) {
  const expected = process.env.DATA_MIGRATION_SHA256;
  if (!expected) return true; // Local empty-database development.
  const row = await env.DB.prepare(
    'SELECT "sourceHash",completed FROM "MigrationManifest" WHERE id=1',
  ).first<{ sourceHash: string; completed: number }>();
  return row?.sourceHash === expected && row.completed === 1;
}
export default {
  async fetch(request: Request, env: Env) {
    if (!(await ready(env)))
      return new Response("Portal maintenance", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    return withDatabase(env.DB, () => handler(request));
  },
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      withDatabase(env.DB, async () => {
        if (!(await ready(env)))
          throw new Error("Data migration is not verified");
        const shop = process.env.SHOPIFY_SHOP;
        if (!shop) throw new Error("Configure SHOPIFY_SHOP");
        // A bounded tick fits the free plan's query budget. Checkpoints/leases
        // persist across ticks; failures remain visible in the admin inbox.
        await discoverOrderUpdates(
          async (query, options) =>
            (await unauthenticated.admin(shop)).admin.graphql(query, options),
          shop,
          { maxPages: 1 },
        );
        await processInboxBatchDetailed(
          async (s) => ({
            graphql: (await unauthenticated.admin(s)).admin.graphql,
          }),
          1,
        );
        const { binding } = databaseContext();
        await binding.batch([
          binding
            .prepare('DELETE FROM "AuthChallenge" WHERE "expiresAt"<?')
            .bind(Date.now() - 86400000),
          binding
            .prepare('DELETE FROM "AuthSession" WHERE "expiresAt"<?')
            .bind(Date.now()),
          binding
            .prepare('DELETE FROM "RateLimitBucket" WHERE "expiresAt"<?')
            .bind(Date.now()),
        ]);
      }),
    );
  },
};
