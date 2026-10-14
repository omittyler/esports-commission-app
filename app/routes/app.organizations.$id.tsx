import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  data,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import db from "../db.server";
import { requireAdmin } from "../services/auth.server";
import { actionError, updateOrganization } from "../services/admin.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      params.id ?? "",
    )
  )
    throw new Response("Organization not found", { status: 404 });
  const org = await db.organization.findUnique({
    where: { id: params.id },
    include: {
      rates: { orderBy: { effectiveFrom: "desc" } },
      assignments: { orderBy: { effectiveFrom: "desc" } },
      _count: { select: { transactions: true } },
    },
  });
  if (!org) throw new Response("Organization not found", { status: 404 });
  return { org };
}
export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await requireAdmin(request);
  try {
    await updateOrganization(
      params.id!,
      await request.formData(),
      session.shop,
    );
    return { success: true, error: null };
  } catch (error) {
    return data({ success: false, error: actionError(error) }, { status: 400 });
  }
}
export default function OrganizationDetail() {
  const { org } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <s-page heading={org.name}>
      <s-link slot="breadcrumb-actions" href="/app/organizations">
        Organizations
      </s-link>
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
      {result?.success && <s-banner tone="success">Changes saved.</s-banner>}
      <s-section heading="Overview">
        <s-paragraph>
          Slug: {org.slug} · {org.status} · {org._count.transactions} ledger
          entries
        </s-paragraph>
        <s-paragraph>
          Commission is calculated on merchandise after discounts, excluding tax
          and shipping. Past ledger entries retain their original rates and
          attribution.
        </s-paragraph>
        <s-link href="/app/products">Manage product assignments</s-link>
      </s-section>
      <s-section heading="Settings">
        <Form method="post">
          <input type="hidden" name="intent" value="settings" />
          <s-stack gap="base">
            <s-text-field
              key={org.name}
              label="Organization name"
              name="name"
              value={org.name}
              required
            />
            <s-select
              key={org.status}
              label="Status"
              name="status"
              value={org.status}
            >
              <s-option value="active">Active</s-option>
              <s-option value="inactive">Inactive</s-option>
            </s-select>
            <s-paragraph>
              Inactive organizations cannot receive new assignments. Existing
              assignments continue earning commission until retired from Product
              assignments.
            </s-paragraph>
            <s-button type="submit" variant="primary" disabled={busy}>
              Save settings
            </s-button>
          </s-stack>
        </Form>
      </s-section>
      <s-section heading="Commission rate history">
        <s-table>
          <s-table-header-row>
            <s-table-header>Rate</s-table-header>
            <s-table-header>From (UTC)</s-table-header>
            <s-table-header>Until (UTC, exclusive)</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {org.rates.map((rate) => (
              <s-table-row key={rate.id}>
                <s-table-cell>{(rate.rateBps / 100).toFixed(2)}%</s-table-cell>
                <s-table-cell>
                  {new Date(rate.effectiveFrom).toISOString()}
                </s-table-cell>
                <s-table-cell>
                  {rate.effectiveTo
                    ? new Date(rate.effectiveTo).toISOString()
                    : "Ongoing"}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
      <s-section heading="Schedule a future rate">
        <Form method="post">
          <input type="hidden" name="intent" value="rate" />
          <s-stack gap="base">
            <s-text-field
              label="Commission percentage"
              name="percentage"
              required
              details="0–100, up to two decimal places."
            />
            <s-text-field
              label="Effective from (UTC)"
              name="effectiveFrom"
              required
              placeholder="2026-11-01T00:00:00Z"
              details="Must be in the future and after the latest scheduled rate."
            />
            <s-button type="submit" disabled={busy}>
              Schedule rate
            </s-button>
          </s-stack>
        </Form>
      </s-section>
      <s-section heading="Assigned products">
        {org.assignments.length ? (
          <s-unordered-list>
            {org.assignments.map((a) => (
              <s-list-item key={a.id}>
                {a.displayTitle} · {a.variantGid ? "Variant" : "Product"} ·{" "}
                {new Date(a.effectiveFrom).toISOString()} →{" "}
                {a.effectiveTo
                  ? new Date(a.effectiveTo).toISOString()
                  : "Ongoing"}
              </s-list-item>
            ))}
          </s-unordered-list>
        ) : (
          <s-paragraph>No product assignments yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
