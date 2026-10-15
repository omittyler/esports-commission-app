import * as UI from "../components/AdminUI";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  data,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { requireAdmin, requireAdminOrigin } from "../services/auth.server";
import { actionError, textField } from "../services/admin.server";
import { reviewAffiliate } from "../services/affiliates/admin.server";
import { affiliateReport } from "../services/affiliates/reporting.server";
import { formatMinor } from "../services/money";
import db from "../db.server";
import { randomUUID } from "node:crypto";
import {
  recordPayment,
  voidPayment,
} from "../services/payments/payments.server";
import {
  CommissionBalances,
  CommissionPaymentTable,
  PaymentHistory,
} from "../components/PaymentReport";
export const headers = () => ({
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
});
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  if (
    !params.id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      params.id,
    )
  )
    throw new Response("Affiliate not found", { status: 404 });
  const account = await db.affiliateAccount.findUnique({
    where: { id: params.id },
  });
  if (!account) throw new Response("Affiliate not found", { status: 404 });
  return data(
    {
      account,
      paymentKey: randomUUID(),
      currency: process.env.SHOP_CURRENCY || "USD",
      report: account.organizationId
        ? await affiliateReport(account.organizationId)
        : null,
    },
    { headers: headers() },
  );
}
export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await requireAdmin(request);
  requireAdminOrigin(request);
  try {
    if (
      !params.id ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        params.id,
      )
    )
      throw new Error("Affiliate not found");
    const form = await request.formData();
    if (
      form.get("intent") === "payment" ||
      form.get("intent") === "voidPayment"
    ) {
      const account = await db.affiliateAccount.findUniqueOrThrow({
        where: { id: params.id },
      });
      if (!account.organizationId)
        throw new Error("Affiliate has no organization");
      if (form.get("intent") === "payment")
        await recordPayment(account.organizationId, form, session.shop);
      else await voidPayment(account.organizationId, form, session.shop);
      return {
        error: null,
        message:
          form.get("intent") === "payment"
            ? "Payment recorded. The partner can see it in Payments."
            : "Recording voided. No money was transferred or reversed.",
      };
    }
    const decision = textField(form, "decision");
    if (!["approved", "rejected", "suspended"].includes(decision))
      throw new Error("Invalid decision");
    await reviewAffiliate(
      params.id!,
      decision as "approved" | "rejected" | "suspended",
      session.shop,
    );
    return { error: null, message: "Affiliate status updated." };
  } catch (error) {
    return data({ error: actionError(error), message: null }, { status: 400 });
  }
}
export default function AffiliateDetail() {
  const {
    account: a,
    report,
    paymentKey,
    currency,
  } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <UI.Page heading={a.displayName}>
      <UI.AdminLink href="/app/affiliates" slot="breadcrumb-actions">
        Affiliates
      </UI.AdminLink>
      {result?.error && <UI.Banner tone="critical">{result.error}</UI.Banner>}
      {result?.message && (
        <UI.Banner tone="success">{result.message}</UI.Banner>
      )}
      <UI.Section heading="Profile">
        <UI.Paragraph>
          {a.type} · {a.status}
        </UI.Paragraph>
        <UI.Paragraph>
          {a.firstName} {a.lastName} · {a.email}
        </UI.Paragraph>
        {a.organizationRole && (
          <UI.Paragraph>Role: {a.organizationRole}</UI.Paragraph>
        )}
        <UI.Paragraph>PayPal email: {a.paypalEmail}</UI.Paragraph>
        <UI.Paragraph>
          Email {a.verifiedAt ? "verified" : "not yet verified"}
        </UI.Paragraph>
        <UI.Stack direction="inline" gap="base">
          {(["approved", "rejected", "suspended"] as const)
            .filter((d) => d !== a.status)
            .map((d) => (
              <Form method="post" key={d}>
                <input type="hidden" name="decision" value={d} />
                <UI.Button
                  type="submit"
                  disabled={busy || (d === "approved" && !a.verifiedAt)}
                >
                  {d === "approved"
                    ? "Approve"
                    : d === "rejected"
                      ? "Reject"
                      : "Suspend"}
                </UI.Button>
              </Form>
            ))}
        </UI.Stack>
      </UI.Section>
      {report && (
        <>
          <CommissionBalances
            totals={
              report.totals.length
                ? report.totals
                : [
                    {
                      currency,
                      base: "0",
                      commission: "0",
                      paid: "0",
                      outstanding: "0",
                      sold: 0,
                      refunded: 0,
                    },
                  ]
            }
          />
          <UI.Section heading="Record a payment">
            <UI.Paragraph>
              Record a payment you have already sent. This app does not send
              money. Commissions are settled oldest first, with outstanding
              refund credits applied before payment.
            </UI.Paragraph>
            <UI.Paragraph>PayPal contact: {a.paypalEmail}</UI.Paragraph>
            <Form method="post" key={paymentKey}>
              <input type="hidden" name="intent" value="payment" />
              <input type="hidden" name="idempotencyKey" value={paymentKey} />
              <input type="hidden" name="currency" value={currency} />
              <UI.Stack>
                <UI.TextField
                  name="amount"
                  label={`Amount paid (${currency})`}
                  placeholder="25.00"
                  required
                  maxLength={30}
                />
                <UI.TextField
                  name="paidAt"
                  label="Payment date (UTC, YYYY-MM-DD)"
                  value={new Date().toISOString().slice(0, 10)}
                  required
                  maxLength={10}
                />
                <UI.Select name="method" label="Payment method" value="paypal">
                  <UI.Option value="paypal">PayPal</UI.Option>
                  <UI.Option value="bank">Bank transfer</UI.Option>
                  <UI.Option value="other">Other</UI.Option>
                </UI.Select>
                <UI.TextField
                  name="reference"
                  label="Transaction reference"
                  details="Use the actual transaction ID or a unique payment reference."
                  required
                  maxLength={120}
                />
                <label className="payment-checkbox">
                  <input
                    type="checkbox"
                    name="confirmed"
                    value="yes"
                    required
                  />
                  I confirm this payment was already sent outside the app.
                </label>
                <UI.Button
                  variant="primary"
                  type="submit"
                  disabled={
                    busy ||
                    a.status !== "approved" ||
                    !report.totals.some(
                      (t) =>
                        t.currency === currency && BigInt(t.outstanding) > 0n,
                    )
                  }
                >
                  Record payment
                </UI.Button>
              </UI.Stack>
            </Form>
          </UI.Section>
          <CommissionPaymentTable orders={report.orders} />
          <PaymentHistory payments={report.payments} />
          {report.payments.some((p) => !p.void) && (
            <UI.Section heading="Correct a recording mistake">
              <UI.Paragraph>
                Voiding preserves the original entry and reopens its commission
                balance. It does not reverse a real transfer. References remain
                reserved; use a distinct correction reference when recording a
                replacement.
              </UI.Paragraph>
              <Form method="post">
                <input type="hidden" name="intent" value="voidPayment" />
                <UI.Stack>
                  <UI.Select name="paymentId" label="Payment record">
                    {report.payments
                      .filter((p) => !p.void)
                      .map((p) => (
                        <UI.Option key={p.id} value={p.id}>
                          {p.reference} · {formatMinor(p.amount, p.currency)}
                        </UI.Option>
                      ))}
                  </UI.Select>
                  <UI.TextField
                    name="reason"
                    label="Reason for correction"
                    required
                    maxLength={500}
                  />
                  <label className="payment-checkbox">
                    <input
                      type="checkbox"
                      name="confirmed"
                      value="yes"
                      required
                    />
                    This record is incorrect. I understand this does not reverse
                    money.
                  </label>
                  <UI.Button type="submit" disabled={busy}>
                    Void recording
                  </UI.Button>
                </UI.Stack>
              </Form>
            </UI.Section>
          )}
          <UI.Section heading="Assigned merchandise">
            <UI.AdminLink
              href={`/app/products?organizationId=${a.organizationId}`}
            >
              Assign a product or collection
            </UI.AdminLink>
            {report.assignments.length ? (
              <UI.List>
                {report.assignments.map((p) => (
                  <UI.ListItem key={p.id}>
                    {p.title} ·{" "}
                    {p.collection ? `Collection: ${p.collection} · ` : ""}
                    {p.program} · {p.from} → {p.to ?? "Ongoing"}
                  </UI.ListItem>
                ))}
              </UI.List>
            ) : (
              <UI.Paragraph>No assigned merchandise yet.</UI.Paragraph>
            )}
          </UI.Section>
          <UI.Section heading="Commission orders">
            {!report.orders.length ? (
              <UI.Paragraph>No commission orders recorded yet.</UI.Paragraph>
            ) : (
              <UI.List>
                {report.orders.map((o) => (
                  <UI.ListItem key={o.key}>
                    {o.name} · {o.products.join(", ")} ·{" "}
                    {formatMinor(o.commission, o.currency)} commission
                  </UI.ListItem>
                ))}
              </UI.List>
            )}
          </UI.Section>
        </>
      )}
    </UI.Page>
  );
}
