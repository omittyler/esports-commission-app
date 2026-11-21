import { randomUUID } from "node:crypto";
import db from "../../db.server";
import { Prisma } from "@prisma/client";
import { webhookResource } from "./orders";
import { reconcileOrder } from "./ingestion.server";
export async function enqueueFinancialWebhook(
  shop: string,
  topic: string,
  eventId: string,
  payload: Record<string, unknown>,
) {
  if (!process.env.SHOPIFY_SHOP || shop !== process.env.SHOPIFY_SHOP)
    throw new Response("Shop not authorized", { status: 403 });
  if (!eventId) throw new Response("Missing event identifier", { status: 400 });
  const resourceGid = webhookResource(topic, payload);
  try {
    return await db.webhookDelivery.create({
      data: { shop, topic, eventId, resourceGid },
    });
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    )
      throw error;
    const existing = await db.webhookDelivery.findUniqueOrThrow({
      where: { shop_topic_eventId: { shop, topic, eventId } },
    });
    if (existing.resourceGid !== resourceGid)
      throw new Error("Webhook replay resource mismatch");
    return existing;
  }
}
export async function processInboxBatch(
  adminForShop: Parameters<typeof processInboxBatchDetailed>[0],
  limit = 20,
) {
  return (await processInboxBatchDetailed(adminForShop, limit)).processed;
}
export async function processInboxBatchDetailed(
  adminForShop: (
    shop: string,
  ) => Promise<{ graphql: Parameters<typeof reconcileOrder>[0] }>,
  limit = 20,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid reconciliation batch size");
  let processed = 0,
    attempted = 0;
  for (let i = 0; i < limit; i++) {
    const token = randomUUID();
    const rows = await db.$queryRaw<
      { id: string; shop: string; resourceGid: string }[]
    >`UPDATE "WebhookDelivery" SET "claimedAt"=clock_timestamp(), "claimToken"=${token}::uuid, attempts=attempts+1 WHERE id=(SELECT id FROM "WebhookDelivery" WHERE "processedAt" IS NULL AND "nextAttemptAt" <= clock_timestamp() AND ("claimedAt" IS NULL OR "claimedAt" < clock_timestamp()-interval '10 minutes') AND shop=${process.env.SHOPIFY_SHOP ?? ""} ORDER BY "receivedAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,shop,"resourceGid"`;
    const event = rows[0];
    if (!event) break;
    attempted++;
    try {
      const admin = await adminForShop(event.shop);
      await reconcileOrder(admin.graphql, event.resourceGid);
      const acknowledged = await db.webhookDelivery.updateMany({
        where: { id: event.id, claimToken: token },
        data: {
          processedAt: new Date(),
          claimedAt: null,
          claimToken: null,
          error: null,
        },
      });
      processed += acknowledged.count;
    } catch {
      await db.webhookDelivery.updateMany({
        where: { id: event.id, claimToken: token },
        data: {
          claimedAt: null,
          claimToken: null,
          nextAttemptAt: new Date(Date.now() + 300000),
          error:
            "Processing failed. Check permissions, payment completion, edited orders, or financial reconciliation.",
        },
      });
    }
  }
  return { processed, attempted };
}
