import * as UI from "../components/AdminUI";
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
    <UI.Page heading={org.name}>
      <UI.AdminLink slot="breadcrumb-actions" href="/app/organizations">
        Organizations
      </UI.AdminLink>
      {result?.error && <UI.Banner tone="critical">{result.error}</UI.Banner>}
      {result?.success && <UI.Banner tone="success">Changes saved.</UI.Banner>}
      <UI.Section heading="Overview">
        <UI.Paragraph>
          Slug: {org.slug} · {org.status} · {org._count.transactions} ledger
          entries
        </UI.Paragraph>
        <UI.Paragraph>
          Commission is calculated on merchandise after discounts, excluding tax
          and shipping. Past ledger entries retain their original rates and
          attribution.
        </UI.Paragraph>
        <UI.AdminLink href="/app/products">
          Manage product assignments
        </UI.AdminLink>
      </UI.Section>
      <UI.Section heading="Settings">
        <Form method="post">
          <input type="hidden" name="intent" value="settings" />
          <UI.Stack gap="base">
            <UI.TextField
              key={org.name}
              label="Organization name"
              name="name"
              value={org.name}
              required
            />
            <UI.Select
              key={org.status}
              label="Status"
              name="status"
              value={org.status}
            >
              <UI.Option value="active">Active</UI.Option>
              <UI.Option value="inactive">Inactive</UI.Option>
            </UI.Select>
            <UI.Paragraph>
              Inactive organizations cannot receive new assignments. Existing
              assignments continue earning commission until retired from Product
              assignments.
            </UI.Paragraph>
            <UI.Button type="submit" variant="primary" disabled={busy}>
              Save settings
            </UI.Button>
          </UI.Stack>
        </Form>
      </UI.Section>
      <UI.Section heading="Commission rate history">
        <UI.Table>
          <UI.TableHeaderRow>
            <UI.TableHeader>Rate</UI.TableHeader>
            <UI.TableHeader>From (UTC)</UI.TableHeader>
            <UI.TableHeader>Until (UTC, exclusive)</UI.TableHeader>
          </UI.TableHeaderRow>
          <UI.TableBody>
            {org.rates.map((rate) => (
              <UI.TableRow key={rate.id}>
                <UI.TableCell>{(rate.rateBps / 100).toFixed(2)}%</UI.TableCell>
                <UI.TableCell>
                  {new Date(rate.effectiveFrom).toISOString()}
                </UI.TableCell>
                <UI.TableCell>
                  {rate.effectiveTo
                    ? new Date(rate.effectiveTo).toISOString()
                    : "Ongoing"}
                </UI.TableCell>
              </UI.TableRow>
            ))}
          </UI.TableBody>
        </UI.Table>
      </UI.Section>
      <UI.Section heading="Schedule a future rate">
        <Form method="post">
          <input type="hidden" name="intent" value="rate" />
          <UI.Stack gap="base">
            <UI.TextField
              label="Commission percentage"
              name="percentage"
              required
              details="0–100, up to two decimal places."
            />
            <UI.TextField
              label="Effective from (UTC)"
              name="effectiveFrom"
              required
              placeholder="2026-11-01T00:00:00Z"
              details="Must be in the future and after the latest scheduled rate."
            />
            <UI.Button type="submit" disabled={busy}>
              Schedule rate
            </UI.Button>
          </UI.Stack>
        </Form>
      </UI.Section>
      <UI.Section heading="Assigned products">
        {org.assignments.length ? (
          <UI.List>
            {org.assignments.map((a) => (
              <UI.ListItem key={a.id}>
                {a.displayTitle} · {a.variantGid ? "Variant" : "Product"} ·{" "}
                {new Date(a.effectiveFrom).toISOString()} →{" "}
                {a.effectiveTo
                  ? new Date(a.effectiveTo).toISOString()
                  : "Ongoing"}
              </UI.ListItem>
            ))}
          </UI.List>
        ) : (
          <UI.Paragraph>No product assignments yet.</UI.Paragraph>
        )}
      </UI.Section>
    </UI.Page>
  );
}
