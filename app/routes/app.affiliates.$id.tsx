import * as UI from "../components/AdminUI";
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
    <UI.Page heading={a.displayName}>
      <UI.AdminLink href="/app/affiliates" slot="breadcrumb-actions">
        Affiliates
      </UI.AdminLink>
      {result?.error && <UI.Banner tone="critical">{result.error}</UI.Banner>}
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
