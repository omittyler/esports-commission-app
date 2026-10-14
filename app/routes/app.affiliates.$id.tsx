import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  data,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { requireAdmin } from "../services/auth.server";
import { actionError, textField } from "../services/admin.server";
import { reviewAffiliate } from "../services/affiliates/admin.server";
import { affiliateReport } from "../services/affiliates/reporting.server";
import { formatMinor } from "../services/money";
import db from "../db.server";
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
      report: account.organizationId
        ? await affiliateReport(account.organizationId)
        : null,
    },
    { headers: headers() },
  );
}
export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await requireAdmin(request);
  try {
    if (
      !params.id ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        params.id,
      )
    )
      throw new Error("Affiliate not found");
    const decision = textField(await request.formData(), "decision");
    if (!["approved", "rejected", "suspended"].includes(decision))
      throw new Error("Invalid decision");
    await reviewAffiliate(
      params.id!,
      decision as "approved" | "rejected" | "suspended",
      session.shop,
    );
    return { error: null };
  } catch (error) {
    return data({ error: actionError(error) }, { status: 400 });
  }
}
export default function AffiliateDetail() {
  const { account: a, report } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <s-page heading={a.displayName}>
      <s-link href="/app/affiliates" slot="breadcrumb-actions">
        Affiliates
      </s-link>
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
      <s-section heading="Profile">
        <s-paragraph>
          {a.type} · {a.status}
        </s-paragraph>
        <s-paragraph>
          {a.firstName} {a.lastName} · {a.email}
        </s-paragraph>
        {a.organizationRole && (
          <s-paragraph>Role: {a.organizationRole}</s-paragraph>
        )}
        <s-paragraph>PayPal email: {a.paypalEmail}</s-paragraph>
        <s-paragraph>
          Email {a.verifiedAt ? "verified" : "not yet verified"}
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          {(["approved", "rejected", "suspended"] as const)
            .filter((d) => d !== a.status)
            .map((d) => (
              <Form method="post" key={d}>
                <input type="hidden" name="decision" value={d} />
                <s-button
                  type="submit"
                  disabled={busy || (d === "approved" && !a.verifiedAt)}
                >
                  {d === "approved"
                    ? "Approve"
                    : d === "rejected"
                      ? "Reject"
                      : "Suspend"}
                </s-button>
              </Form>
            ))}
        </s-stack>
      </s-section>
      {report && (
        <>
          <s-section heading="Assigned merchandise">
            <s-link href={`/app/products?organizationId=${a.organizationId}`}>
              Assign a product or collection
            </s-link>
            {report.assignments.length ? (
              <s-unordered-list>
                {report.assignments.map((p) => (
                  <s-list-item key={p.id}>
                    {p.title} ·{" "}
                    {p.collection ? `Collection: ${p.collection} · ` : ""}
                    {p.program} · {p.from} → {p.to ?? "Ongoing"}
                  </s-list-item>
                ))}
              </s-unordered-list>
            ) : (
              <s-paragraph>No assigned merchandise yet.</s-paragraph>
            )}
          </s-section>
          <s-section heading="Commission orders">
            {!report.orders.length ? (
              <s-paragraph>No commission orders recorded yet.</s-paragraph>
            ) : (
              <s-unordered-list>
                {report.orders.map((o) => (
                  <s-list-item key={o.key}>
                    {o.name} · {o.products.join(", ")} ·{" "}
                    {formatMinor(o.commission, o.currency)} commission
                  </s-list-item>
                ))}
              </s-unordered-list>
            )}
          </s-section>
        </>
      )}
    </s-page>
  );
}
