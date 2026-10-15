import * as UI from "../components/AdminUI";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, data, useActionData, useLoaderData } from "react-router";
import { requireAdmin, requireAdminOrigin } from "../services/auth.server";
import { requestCatchUp } from "../services/shopify/catchup.server";
import { syncIntervalMs, SYNC_LEASE_MS } from "../services/shopify/catchup";
import { reconcileOrder } from "../services/shopify/ingestion.server";
import { textField } from "../services/admin.server";
import db from "../db.server";
export const headers = () => ({
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
});
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await requireAdmin(request);
  const [events, sync, pending, failed] = await db.$transaction(
    [
      db.webhookDelivery.findMany({
        where: { shop: session.shop },
        orderBy: { receivedAt: "desc" },
        take: 100,
      }),
      db.orderSyncState.findUnique({ where: { shop: session.shop } }),
      db.webhookDelivery.count({
        where: { shop: session.shop, processedAt: null },
      }),
      db.webhookDelivery.count({
        where: { shop: session.shop, processedAt: null, error: { not: null } },
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  return data(
    {
      orderAccess: session.scope?.split(",").includes("read_orders") ?? false,
      events,
      sync,
      pending,
      failed,
      scanEnabled: process.env.ORDER_SYNC_ENABLED !== "false",
      scanMinutes: syncIntervalMs() / 60000,
    },
    { headers: headers() },
  );
}
export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await requireAdmin(request);
  requireAdminOrigin(request);
  if (!session.scope?.split(",").includes("read_orders"))
    return data(
      {
        error: "Shopify order access has not been approved yet.",
        success: false,
        message: null,
      },
      { status: 403 },
    );
  try {
    const form = await request.formData();
    const intent = form.get("intent");
    if (intent === "catchup" || intent === "restart") {
      await requestCatchUp(session.shop, intent === "restart");
      return {
        error: null,
        success: true,
        message:
          "Recent-order scan requested. The running worker will discover and reconcile it; refresh this page to see progress.",
      };
    }
    if (intent === "retry") {
      const result = await db.webhookDelivery.updateMany({
        where: {
          shop: session.shop,
          processedAt: null,
          error: { not: null },
          OR: [
            { claimedAt: null },
            { claimedAt: { lt: new Date(Date.now() - SYNC_LEASE_MS) } },
          ],
        },
        data: {
          nextAttemptAt: new Date(),
          claimedAt: null,
          claimToken: null,
          error: null,
        },
      });
      return {
        error: null,
        success: true,
        message: `${result.count} failed deliveries queued for retry. Financial safeguards remain active.`,
      };
    }
    if (intent !== null && intent !== "reconcile")
      throw new Error("Invalid intent");
    const gid = textField(form, "orderGid");
    if (!/^gid:\/\/shopify\/Order\/\d+$/.test(gid))
      throw new Error("Enter a Shopify Order GID");
    await reconcileOrder(
      (query, options) => admin.graphql(query, options),
      gid,
    );
    return {
      error: null,
      success: true,
      message: "Order and refunds reconciled.",
    };
  } catch {
    return data(
      {
        error:
          "Order could not be reconciled. Check its payment status, access window, and immutable financial history.",
        success: false,
        message: null,
      },
      { status: 400 },
    );
  }
}
export default function Ingestion() {
  const {
    orderAccess,
    events,
    sync,
    pending,
    failed,
    scanEnabled,
    scanMinutes,
  } = useLoaderData<typeof loader>();
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
        <UI.Banner tone="success">{result.message}</UI.Banner>
      )}
      <UI.Section heading="Automatic catch-up">
        <UI.Paragraph>
          {scanEnabled
            ? `The running worker scans every ${scanMinutes} minutes and repeats a full recent-order sweep daily.`
            : "Automatic discovery is disabled for this deployment. Use the scheduled refresh command or enable it for the worker."}
        </UI.Paragraph>
        <UI.Paragraph>
          Catch-up covers a 59-day safety window within current Shopify order
          access. Recent scans overlap to find delayed sales and refund updates.
          Older orders and long downtime require a separate access/recovery
          review.
        </UI.Paragraph>
        <UI.Paragraph>
          Last scan completed:{" "}
          {sync?.lastCompletedAt
            ? new Date(sync.lastCompletedAt).toISOString()
            : "Not yet"}
          . Orders checked through:{" "}
          {sync?.completedThrough
            ? new Date(sync.completedThrough).toISOString()
            : "Not yet"}
          .
        </UI.Paragraph>
        <UI.Paragraph>
          {sync?.windowTo
            ? "A scan is incomplete and will resume from its saved page."
            : "No scan currently in progress."}{" "}
          {sync
            ? `${sync.discovered} paid or refunded orders found in the latest scan.`
            : ""}
        </UI.Paragraph>
        <UI.Paragraph>
          {pending} updates awaiting reconciliation; {failed} have failed and
          need retry or review. A completed scan does not mean every commission
          has been posted.
        </UI.Paragraph>
        {sync?.lastError && (
          <UI.Banner tone="warning">{sync.lastError}</UI.Banner>
        )}
        {sync?.coverageGapAt && (
          <UI.Banner tone="critical">
            Recovery coverage needs review:{" "}
            {new Date(sync.coverageGapFrom!).toISOString()} →{" "}
            {new Date(sync.coverageGapTo!).toISOString()}. Recent scans cannot
            certify this older interval; this warning is retained.
          </UI.Banner>
        )}
        <UI.Stack direction="inline">
          <Form method="post">
            <input type="hidden" name="intent" value="catchup" />
            <UI.Button type="submit" disabled={!orderAccess || !scanEnabled}>
              Request recent-order scan
            </UI.Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="restart" />
            <UI.Button type="submit" disabled={!orderAccess || !scanEnabled}>
              Restart recent-order scan
            </UI.Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="retry" />
            <UI.Button type="submit" disabled={!orderAccess || !failed}>
              Retry failed deliveries
            </UI.Button>
          </Form>
        </UI.Stack>
        <UI.Paragraph>
          Restart rediscovers recent orders without changing posted history. The
          worker must be running for queued work to proceed.
        </UI.Paragraph>
      </UI.Section>
      <UI.Section heading="Reconcile a paid order">
        <UI.Paragraph>
          Reconciliation reads merchandise lines and refunds, preserves posted
          history, and flags changed financial input. Orders outside Shopify’s
          recent-order access window require additional approval.
        </UI.Paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="reconcile" />
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
      <UI.Section heading="Reconciliation inbox">
        <UI.Paragraph>
          Signed webhooks and catch-up discoveries are durably queued. The
          background worker retries failures; this page shows the latest 100
          deliveries. CATCH_UP_ORDER rows contain order IDs and update
          timestamps, not customer payloads.
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
