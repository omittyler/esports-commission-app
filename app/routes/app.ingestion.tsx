import * as UI from "../components/AdminUI";
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
    <UI.Page heading="Order ingestion">
      {!orderAccess && (
        <UI.Banner tone="warning">
          Shopify order access must be approved before live reporting can
          populate.
        </UI.Banner>
      )}
      {result?.error && <UI.Banner tone="critical">{result.error}</UI.Banner>}
      {result?.success && (
        <UI.Banner tone="success">Order and refunds reconciled.</UI.Banner>
      )}
      <UI.Section heading="Reconcile a paid order">
        <UI.Paragraph>
          Reconciliation reads merchandise lines and refunds, preserves posted
          history, and flags changed financial input. Orders outside Shopify’s
          recent-order access window require additional approval.
        </UI.Paragraph>
        <Form method="post">
          <UI.TextField
            label="Shopify Order GID"
            name="orderGid"
            required
            placeholder="gid://shopify/Order/123456789"
          />
          <UI.Button type="submit" disabled={!orderAccess}>
            Reconcile order
          </UI.Button>
        </Form>
      </UI.Section>
      <UI.Section heading="Webhook inbox">
        <UI.Paragraph>
          Signed events are durably queued. The background worker retries
          failures; this page shows the latest 100 deliveries.
        </UI.Paragraph>
        <UI.Table>
          <UI.TableHeaderRow>
            <UI.TableHeader>Received (UTC)</UI.TableHeader>
            <UI.TableHeader>Topic</UI.TableHeader>
            <UI.TableHeader>Resource</UI.TableHeader>
            <UI.TableHeader>Status</UI.TableHeader>
          </UI.TableHeaderRow>
          <UI.TableBody>
            {events.map((e) => (
              <UI.TableRow key={e.id}>
                <UI.TableCell>
                  {new Date(e.receivedAt).toISOString()}
                </UI.TableCell>
                <UI.TableCell>{e.topic}</UI.TableCell>
                <UI.TableCell>{e.resourceGid}</UI.TableCell>
                <UI.TableCell>
                  {e.processedAt ? "Processed" : (e.error ?? "Queued")}
                </UI.TableCell>
              </UI.TableRow>
            ))}
          </UI.TableBody>
        </UI.Table>
      </UI.Section>
    </UI.Page>
  );
}
