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
  assignCollectionSnapshot,
  effectiveDate,
  retireAssignment,
  textField,
} from "../services/admin.server";
import {
  ASSIGNMENT_QUERY,
  CATALOG_QUERY,
  COLLECTIONS_QUERY,
  type CatalogProduct,
  type CatalogVariant,
} from "../services/shopify/catalog";
import { collectionProducts } from "../services/shopify/collection.server";

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
  const collectionResponse = await admin.graphql(COLLECTIONS_QUERY, {
    variables: {
      query: url.searchParams.get("cq") ?? "",
      after: url.searchParams.get("cafter"),
    },
  });
  const collectionBody = await collectionResponse.json();
  if (
    !collectionResponse.ok ||
    ("errors" in collectionBody && collectionBody.errors) ||
    !collectionBody.data?.collections
  )
    throw new Response("Unable to load Shopify collections", { status: 502 });
  const collections = collectionBody.data.collections as {
    nodes: CatalogProduct[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
  let selectedCollection: Awaited<
    ReturnType<typeof collectionProducts>
  > | null = null;
  let previewError: string | null = null;
  if (url.searchParams.get("collection")) {
    try {
      selectedCollection = await collectionProducts(
        (query, options) => admin.graphql(query, options),
        url.searchParams.get("collection")!,
      );
    } catch (error) {
      previewError = actionError(error);
    }
  }
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
    collections,
    selectedCollection,
    previewError,
    cq: url.searchParams.get("cq") ?? "",
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await requireAdmin(request);
  try {
    const form = await request.formData();
    const intent = textField(form, "intent");
    if (intent === "assignCollection") {
      const snapshot = await collectionProducts(
        (query, options) => admin.graphql(query, options),
        textField(form, "collectionGid"),
      );
      const result = await assignCollectionSnapshot(
        {
          organizationId: textField(form, "organizationId"),
          collectionGid: snapshot.collectionGid,
          collectionTitle: snapshot.title,
          products: snapshot.products,
          effectiveFrom: effectiveDate(form),
        },
        session.shop,
      );
      const skippedNames = result.skipped
        .slice(0, 5)
        .map((p) => p.title)
        .join(", ");
      return {
        error: null,
        success: true,
        message: `Assigned ${result.assigned} current products from ${snapshot.title}. ${result.skipped.length} products were skipped to preserve existing product or variant assignments.${skippedNames ? ` Skipped: ${skippedNames}${result.skipped.length > 5 ? ", …" : ""}.` : ""}`,
      };
    }
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
    return { error: null, success: true, message: "Assignment saved." };
  } catch (error) {
    return data(
      { error: actionError(error), success: false, message: null },
      { status: 400 },
    );
  }
}
export default function Products() {
  const {
    catalog,
    organizations,
    assignments,
    q,
    collections,
    selectedCollection,
    previewError,
    cq,
  } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <s-page heading="Product assignments">
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
      {result?.success && <s-banner tone="success">{result.message}</s-banner>}
      <s-section heading="Assign products from a collection">
        <s-paragraph>
          Assign the collection’s current products in one step. Products added
          or removed later do not change these assignments. Existing product or
          variant assignments are preserved and reported as skipped.
        </s-paragraph>
        <Form method="get">
          <input type="hidden" name="q" value={q} />
          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
            <s-text-field label="Search collections" name="cq" value={cq} />
            <s-button type="submit">Search collections</s-button>
          </s-grid>
        </Form>
        {collections.nodes.length ? (
          <Form method="get">
            <input type="hidden" name="q" value={q} />
            <input type="hidden" name="cq" value={cq} />
            <s-stack gap="base">
              <s-select
                label="Collection"
                name="collection"
                value={
                  selectedCollection?.collectionGid ?? collections.nodes[0].id
                }
              >
                {selectedCollection &&
                  !collections.nodes.some(
                    (c) => c.id === selectedCollection.collectionGid,
                  ) && (
                    <s-option value={selectedCollection.collectionGid}>
                      {selectedCollection.title}
                    </s-option>
                  )}
                {collections.nodes.map((c) => (
                  <s-option key={c.id} value={c.id}>
                    {c.title}
                  </s-option>
                ))}
              </s-select>
              <s-button type="submit" disabled={busy}>
                Preview collection
              </s-button>
            </s-stack>
          </Form>
        ) : (
          <s-paragraph>No matching collections.</s-paragraph>
        )}
        {collections.pageInfo.hasNextPage && (
          <s-link
            href={`/app/products?${new URLSearchParams({ q, cq, cafter: collections.pageInfo.endCursor! })}`}
          >
            Next collections page
          </s-link>
        )}
        {previewError && <s-banner tone="critical">{previewError}</s-banner>}
        {selectedCollection && (
          <s-section
            heading={`${selectedCollection.title} · ${selectedCollection.products.length} current products`}
          >
            {selectedCollection.products.length ? (
              <>
                <s-unordered-list>
                  {selectedCollection.products.slice(0, 20).map((p) => (
                    <s-list-item key={p.id}>{p.title}</s-list-item>
                  ))}
                </s-unordered-list>
                {selectedCollection.products.length > 20 && (
                  <s-paragraph>
                    Showing the first 20 products. All{" "}
                    {selectedCollection.products.length} current products will
                    be considered.
                  </s-paragraph>
                )}
                <s-paragraph>
                  Membership is read again when you save. Existing assignments
                  are skipped; all eligible products are saved together.
                </s-paragraph>
                {organizations.length > 0 ? (
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="assignCollection"
                    />
                    <input
                      type="hidden"
                      name="collectionGid"
                      value={selectedCollection.collectionGid}
                    />
                    <s-stack gap="base">
                      <s-select
                        label="Collection organization"
                        name="organizationId"
                      >
                        {organizations.map((o) => (
                          <s-option key={o.id} value={o.id}>
                            {o.name}
                          </s-option>
                        ))}
                      </s-select>
                      <s-text-field
                        label="Collection effective from (UTC)"
                        name="effectiveFrom"
                        required
                        placeholder="2026-11-01T00:00:00Z"
                        details="Future ISO timestamp ending in Z."
                      />
                      <s-button type="submit" variant="primary" disabled={busy}>
                        Assign current collection products
                      </s-button>
                    </s-stack>
                  </Form>
                ) : (
                  <s-paragraph>
                    Create an active organization before assigning products.
                  </s-paragraph>
                )}
              </>
            ) : (
              <s-paragraph>
                This collection is empty. No products can be assigned.
              </s-paragraph>
            )}
          </s-section>
        )}
      </s-section>
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
