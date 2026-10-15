import { randomUUID } from "node:crypto";
import db from "../../db.server";
import { serializable } from "../admin.server";
import {
  ORDER_UPDATES_QUERY,
  SYNC_LEASE_MS,
  SYNC_ERROR,
  orderSearch,
  scanWindow,
  syncIntervalMs,
  validateDiscoveryPage,
  type DiscoveryPage,
} from "./catchup";
export type DiscoveryGraphql = (
  query: string,
  options: { variables: { query: string; after: string | null } },
) => Promise<Response>;
function allowedShop(shop: string) {
  if (!process.env.SHOPIFY_SHOP || shop !== process.env.SHOPIFY_SHOP)
    throw new Response("Shop is not authorized", { status: 403 });
}
export async function requestCatchUp(shop: string, restart = false) {
  allowedShop(shop);
  return db.orderSyncState.upsert({
    where: { shop },
    create: { shop, forceFull: true },
    update: {
      forceFull: true,
      nextScanAt: new Date(),
      ...(restart
        ? {
            windowFrom: null,
            windowTo: null,
            creationFloor: null,
            cursor: null,
            cursorHistory: [],
            claimedAt: null,
            claimToken: null,
            lastError: null,
          }
        : {}),
    },
  });
}

/** Only discovery progress advances here. Financial reconciliation stays in the
 * durable inbox; unsupported or failed orders are never counted as settled. */
export async function discoverOrderUpdates(
  graphql: DiscoveryGraphql,
  shop: string,
  options: { maxPages?: number; now?: () => Date } = {},
) {
  allowedShop(shop);
  const interval = syncIntervalMs();
  const maxPages = options.maxPages ?? 3;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100)
    throw new Error("Invalid catch-up page budget");
  const now = options.now ?? (() => new Date());
  const token = randomUUID();
  const initial = await serializable(async (tx) => {
    await tx.orderSyncState.upsert({
      where: { shop },
      create: { shop, nextScanAt: now() },
      update: {},
    });
    await tx.$queryRaw`SELECT shop FROM "OrderSyncState" WHERE shop = ${shop} FOR UPDATE`;
    const state = await tx.orderSyncState.findUniqueOrThrow({
      where: { shop },
    });
    const current = now();
    if (
      state.claimedAt &&
      state.claimedAt.getTime() > current.getTime() - SYNC_LEASE_MS
    )
      return "busy" as const;
    if (state.nextScanAt > current) return "idle" as const;
    let window = {};
    if (!state.windowTo) {
      const planned = scanWindow(
        current,
        state.completedThrough,
        state.lastFullScanAt,
        state.forceFull,
      );
      window = {
        windowFrom: planned.windowFrom,
        windowTo: planned.windowTo,
        creationFloor: planned.creationFloor,
        fullSweep: planned.fullSweep,
        forceFull: false,
        cursor: null,
        cursorHistory: [],
        discovered: 0,
        ...(planned.gap && !state.coverageGapAt
          ? {
              coverageGapAt: current,
              coverageGapFrom: planned.gap.from,
              coverageGapTo: planned.gap.to,
            }
          : {}),
      };
    }
    return tx.orderSyncState.update({
      where: { shop },
      data: {
        ...window,
        claimToken: token,
        claimedAt: current,
        lastError: null,
      },
    });
  });
  if (typeof initial === "string")
    return { status: initial, pages: 0, queued: 0 };
  let state = initial,
    pages = 0,
    queued = 0;
  try {
    while (pages < maxPages) {
      if (!state.windowFrom || !state.windowTo || !state.creationFloor)
        throw new Error("Missing discovery window");
      // An abandoned cursor can become too old for the granted recent-order
      // access. Restart the window and retain a visible coverage warning.
      if (state.creationFloor.getTime() < now().getTime() - 60 * 86400000) {
        await db.orderSyncState.updateMany({
          where: { shop, claimToken: token },
          data: {
            windowFrom: null,
            windowTo: null,
            creationFloor: null,
            cursor: null,
            cursorHistory: [],
            forceFull: true,
            claimedAt: null,
            claimToken: null,
            nextScanAt: now(),
            lastError:
              "Interrupted scan outgrew Shopify's recent-order access. A fresh scan is requested; older coverage requires review.",
            ...(!state.coverageGapAt &&
            state.windowFrom < new Date(now().getTime() - 59 * 86400000)
              ? {
                  coverageGapAt: now(),
                  coverageGapFrom: state.windowFrom,
                  coverageGapTo: new Date(now().getTime() - 59 * 86400000),
                }
              : {}),
          },
        });
        return { status: "restart" as const, pages, queued };
      }
      const response = await graphql(ORDER_UPDATES_QUERY, {
        variables: {
          query: orderSearch({
            windowFrom: state.windowFrom,
            windowTo: state.windowTo,
            creationFloor: state.creationFloor,
          }),
          after: state.cursor,
        },
      });
      const body = await response.json();
      if (
        !response.ok ||
        body.errors ||
        !body.data?.orders ||
        body.extensions?.search?.some(
          (s: { warnings?: unknown[] }) => s.warnings?.length,
        )
      )
        throw new Error(
          "Order discovery query failed or returned search warnings",
        );
      const page: DiscoveryPage = body.data.orders;
      const next = validateDiscoveryPage(page, {
        windowFrom: state.windowFrom,
        windowTo: state.windowTo,
        creationFloor: state.creationFloor,
        cursorHistory: state.cursorHistory,
      });
      const saved = await serializable(async (tx) => {
        await tx.$queryRaw`SELECT shop FROM "OrderSyncState" WHERE shop = ${shop} FOR UPDATE`;
        const current = await tx.orderSyncState.findUniqueOrThrow({
          where: { shop },
        });
        if (
          current.claimToken !== token ||
          !current.claimedAt ||
          current.claimedAt.getTime() <= now().getTime() - SYNC_LEASE_MS
        )
          throw new Error("Catch-up lease expired");
        const deliveries = page.nodes.map((o) => ({
          shop,
          topic: "CATCH_UP_ORDER",
          eventId: JSON.stringify([o.id, new Date(o.updatedAt).toISOString()]),
          resourceGid: o.id,
        }));
        const inserted = await tx.webhookDelivery.createMany({
          data: deliveries,
          skipDuplicates: true,
        });
        // A full sweep rechecks previously successful reconciliations too:
        // refund/payment updates must not depend solely on an updatedAt change.
        // Reuse synthetic inbox rows. Work checked after this window's cutoff
        // is not requeued by page replay or an immediate repeated refresh.
        const rechecked = current.fullSweep
          ? await tx.webhookDelivery.updateMany({
              where: {
                shop,
                topic: "CATCH_UP_ORDER",
                eventId: { in: deliveries.map((d) => d.eventId) },
                processedAt: { lt: current.windowTo! },
                claimedAt: null,
              },
              data: { processedAt: null, nextAttemptAt: now(), error: null },
            })
          : { count: 0 };
        const complete = !next;
        const updated = await tx.orderSyncState.update({
          where: { shop },
          data: {
            discovered: current.discovered + page.nodes.length,
            ...(complete
              ? {
                  completedThrough: current.windowTo,
                  lastCompletedAt: now(),
                  ...(current.fullSweep ? { lastFullScanAt: now() } : {}),
                  windowFrom: null,
                  windowTo: null,
                  creationFloor: null,
                  cursor: null,
                  cursorHistory: [],
                  claimedAt: null,
                  claimToken: null,
                  nextScanAt: current.forceFull
                    ? now()
                    : new Date(now().getTime() + interval),
                }
              : {
                  cursor: next,
                  cursorHistory: [...current.cursorHistory, next!],
                  claimedAt: now(),
                }),
          },
        });
        return { updated, queued: inserted.count + rechecked.count, complete };
      });
      state = saved.updated;
      queued += saved.queued;
      pages++;
      if (saved.complete) return { status: "complete" as const, pages, queued };
    }
    await db.orderSyncState.updateMany({
      where: { shop, claimToken: token },
      data: { claimedAt: null, claimToken: null, nextScanAt: now() },
    });
    return { status: "partial" as const, pages, queued };
  } catch {
    await db.orderSyncState.updateMany({
      where: { shop, claimToken: token },
      data: {
        claimedAt: null,
        claimToken: null,
        lastError: SYNC_ERROR,
        nextScanAt: new Date(now().getTime() + 300000),
      },
    });
    return { status: "failed" as const, pages, queued };
  }
}
