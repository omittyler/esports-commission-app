import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueFinancialWebhook } from "../services/shopify/inbox.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic, payload } = await authenticate.webhook(request);
  await enqueueFinancialWebhook(
    shop,
    topic,
    request.headers.get("X-Shopify-Event-Id") ||
      request.headers.get("X-Shopify-Webhook-Id") ||
      "",
    payload,
  );
  return new Response(null, { status: 200 });
}
