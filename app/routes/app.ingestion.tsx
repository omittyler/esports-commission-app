import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, data, useActionData, useLoaderData } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { reconcileOrder } from "../services/shopify/ingestion.server";
import { textField } from "../services/admin.server";
import db from "../db.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await requireAdmin(request);
  return {
    orderAccess: session.scope?.split(",").includes("read_orders") ?? false,
    events: await db.webhookDelivery.findMany({
      orderBy: { receivedAt: "desc" },
      take: 100,
    }),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await requireAdmin(request);
  if (!session.scope?.split(",").includes("read_orders"))
    return data(
      {
        error: "Shopify order access has not been approved yet.",
        success: false,
      },
      { status: 403 },
    );
  try {
    const gid = textField(await request.formData(), "orderGid");
    if (!/^gid:\/\/shopify\/Order\/\d+$/.test(gid))
      throw new Error("Enter a Shopify Order GID");
    await reconcileOrder(
      (query, options) => admin.graphql(query, options),
      gid,
    );
    return { error: null, success: true };
  } catch {
    return data(
      {
        error:
          "Order could not be reconciled. Check its payment status, access window, and immutable financial history.",
        success: false,
      },
      { status: 400 },
    );
  }
}
export default function Ingestion() {
  const { orderAccess, events } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <s-page heading="Order ingestion">
      {!orderAccess && (
        <s-banner tone="warning">
          Shopify order access must be approved before live reporting can
          populate.
        </s-banner>
      )}
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
      {result?.success && (
        <s-banner tone="success">Order and refunds reconciled.</s-banner>
      )}
      <s-section heading="Reconcile a paid order">
        <s-paragraph>
          Reconciliation reads merchandise lines and refunds, preserves posted
          history, and flags changed financial input. Orders outside Shopify’s
          recent-order access window require additional approval.
        </s-paragraph>
        <Form method="post">
          <s-text-field
            label="Shopify Order GID"
            name="orderGid"
            required
            placeholder="gid://shopify/Order/123456789"
          />
          <s-button type="submit" disabled={!orderAccess}>
            Reconcile order
          </s-button>
        </Form>
      </s-section>
      <s-section heading="Webhook inbox">
        <s-paragraph>
          Signed events are durably queued. The background worker retries
          failures; this page shows the latest 100 deliveries.
        </s-paragraph>
        <s-table>
          <s-table-header-row>
            <s-table-header>Received (UTC)</s-table-header>
            <s-table-header>Topic</s-table-header>
            <s-table-header>Resource</s-table-header>
            <s-table-header>Status</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {events.map((e) => (
              <s-table-row key={e.id}>
                <s-table-cell>
                  {new Date(e.receivedAt).toISOString()}
                </s-table-cell>
                <s-table-cell>{e.topic}</s-table-cell>
                <s-table-cell>{e.resourceGid}</s-table-cell>
                <s-table-cell>
                  {e.processedAt ? "Processed" : (e.error ?? "Queued")}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}
