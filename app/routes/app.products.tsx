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
import {
  actionError,
  assignProduct,
  effectiveDate,
  retireAssignment,
  textField,
} from "../services/admin.server";
import {
  ASSIGNMENT_QUERY,
  CATALOG_QUERY,
  type CatalogVariant,
} from "../services/shopify/catalog";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await requireAdmin(request);
  const url = new URL(request.url);
  const response = await admin.graphql(CATALOG_QUERY, {
    variables: {
      query: url.searchParams.get("q") ?? "",
      after: url.searchParams.get("after"),
    },
  });
  const body = await response.json();
  if (
    !response.ok ||
    ("errors" in body && body.errors) ||
    !body.data?.productVariants
  )
    throw new Response("Unable to load Shopify catalog", { status: 502 });
  const catalog = body.data.productVariants as {
    nodes: CatalogVariant[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
  const [organizations, assignments] = await Promise.all([
    db.organization.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
    }),
    db.productAssignment.findMany({
      include: { organization: true },
      orderBy: { effectiveFrom: "desc" },
    }),
  ]);
  return {
    catalog,
    organizations,
    assignments,
    q: url.searchParams.get("q") ?? "",
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await requireAdmin(request);
  try {
    const form = await request.formData();
    const intent = textField(form, "intent");
    if (intent === "retire")
      await retireAssignment(textField(form, "assignmentId"), session.shop);
    else if (intent === "assign") {
      const targetGid = textField(form, "targetGid");
      if (!/^gid:\/\/shopify\/(Product|ProductVariant)\/\d+$/.test(targetGid))
        throw new Error("Invalid Shopify target");
      const response = await admin.graphql(ASSIGNMENT_QUERY, {
        variables: { id: targetGid },
      });
      const body = await response.json();
      if (!response.ok || ("errors" in body && body.errors) || !body.data?.node)
        throw new Error("Shopify product or variant was not found");
      const target = body.data.node as {
        id: string;
        title: string;
        product?: { id: string; title: string };
      };
      await assignProduct(
        {
          organizationId: textField(form, "organizationId"),
          productGid: target.product?.id ?? target.id,
          variantGid: target.product ? target.id : null,
          displayTitle: target.product
            ? `${target.product.title} / ${target.title}`
            : target.title,
          effectiveFrom: effectiveDate(form),
        },
        session.shop,
      );
    } else throw new Error("Unknown action");
    return { error: null, success: true };
  } catch (error) {
    return data({ error: actionError(error), success: false }, { status: 400 });
  }
}
export default function Products() {
  const { catalog, organizations, assignments, q } =
    useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <s-page heading="Product assignments">
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
      {result?.success && <s-banner tone="success">Assignment saved.</s-banner>}
      <s-section heading="Search Shopify catalog">
        <Form method="get">
          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
            <s-text-field
              label="Search products and variants"
              name="q"
              value={q}
            />
            <s-button type="submit">Search</s-button>
          </s-grid>
        </Form>
        {!catalog.nodes.length && (
          <s-paragraph>No matching merchandise.</s-paragraph>
        )}
        <s-unordered-list>
          {catalog.nodes.map((v) => (
            <s-list-item key={v.id}>
              {v.product.title} / {v.title}
            </s-list-item>
          ))}
        </s-unordered-list>
        {catalog.pageInfo.hasNextPage && (
          <s-link
            href={`/app/products?q=${encodeURIComponent(q)}&after=${encodeURIComponent(catalog.pageInfo.endCursor!)}`}
          >
            Next catalog page
          </s-link>
        )}
      </s-section>
      <s-section heading="Assign merchandise">
        <s-paragraph>
          Variant assignments take precedence over product assignments. Saving
          replaces the current assignment for the same target from the specified
          time, preserving its history.
        </s-paragraph>
        {organizations.length > 0 && catalog.nodes.length > 0 ? (
          <Form method="post">
            <input type="hidden" name="intent" value="assign" />
            <s-stack gap="base">
              <s-select label="Product or variant" name="targetGid">
                {Array.from(
                  new Map(
                    catalog.nodes.map((v) => [v.product.id, v.product]),
                  ).values(),
                ).map((p) => (
                  <s-option key={p.id} value={p.id}>
                    {p.title} — All variants
                  </s-option>
                ))}
                {catalog.nodes.map((v) => (
                  <s-option key={v.id} value={v.id}>
                    {v.product.title} / {v.title}
                  </s-option>
                ))}
              </s-select>
              <s-select label="Organization" name="organizationId">
                {organizations.map((o) => (
                  <s-option key={o.id} value={o.id}>
                    {o.name}
                  </s-option>
                ))}
              </s-select>
              <s-text-field
                label="Effective from (UTC)"
                name="effectiveFrom"
                required
                placeholder="2026-11-01T00:00:00Z"
                details="Future ISO timestamp ending in Z."
              />
              <s-button type="submit" variant="primary" disabled={busy}>
                Save assignment
              </s-button>
            </s-stack>
          </Form>
        ) : (
          <s-paragraph>
            Create an active organization and find a catalog product before
            assigning merchandise.
          </s-paragraph>
        )}
      </s-section>
      <s-section heading="Assignment history">
        <s-table>
          <s-table-header-row>
            <s-table-header>Merchandise</s-table-header>
            <s-table-header>Organization</s-table-header>
            <s-table-header>From (UTC)</s-table-header>
            <s-table-header>Until (UTC)</s-table-header>
            <s-table-header>Action</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {assignments.map((a) => (
              <s-table-row key={a.id}>
                <s-table-cell>
                  {a.displayTitle} · {a.variantGid ? "Variant" : "Product"}
                </s-table-cell>
                <s-table-cell>{a.organization.name}</s-table-cell>
                <s-table-cell>
                  {new Date(a.effectiveFrom).toISOString()}
                </s-table-cell>
                <s-table-cell>
                  {a.effectiveTo
                    ? new Date(a.effectiveTo).toISOString()
                    : "Ongoing"}
                </s-table-cell>
                <s-table-cell>
                  {new Date(a.effectiveFrom) < new Date() &&
                    (!a.effectiveTo ||
                      new Date(a.effectiveTo) > new Date()) && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="retire" />
                        <input type="hidden" name="assignmentId" value={a.id} />
                        <s-button type="submit" disabled={busy}>
                          Retire now
                        </s-button>
                      </Form>
                    )}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}
