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
import { formatMinor } from "../services/money";

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
  const [organizations, assignments, programs] = await Promise.all([
    db.organization.findMany({
      where: {
        status: "active",
        OR: [
          { account: { is: null } },
          { account: { is: { status: "approved" } } },
        ],
      },
      orderBy: { name: "asc" },
    }),
    db.productAssignment.findMany({
      include: { organization: true, programVersion: true },
      orderBy: { effectiveFrom: "desc" },
    }),
    db.commissionProgram.findMany({
      where: { active: true },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    catalog,
    organizations,
    assignments: assignments.map((a) => ({
      ...a,
      programVersion: a.programVersion
        ? {
            ...a.programVersion,
            fixedMinor: a.programVersion.fixedMinor?.toString() ?? null,
          }
        : null,
    })),
    programs: programs.flatMap((p) =>
      p.versions.map((v) => ({
        id: v.id,
        label: `${p.name} · ${v.kind === "percentage" ? `${v.rateBps / 100}%` : `${formatMinor(v.fixedMinor!, v.currency)} / item`}`,
      })),
    ),
    q: url.searchParams.get("q") ?? "",
    collections,
    selectedCollection,
    previewError,
    cq: url.searchParams.get("cq") ?? "",
    selectedOrganization:
      organizations.find((o) => o.id === url.searchParams.get("organizationId"))
        ?.id ??
      organizations[0]?.id ??
      "",
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
          programVersionId:
            typeof form.get("programVersionId") === "string"
              ? String(form.get("programVersionId")) || null
              : null,
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
          programVersionId:
            typeof form.get("programVersionId") === "string"
              ? String(form.get("programVersionId")) || null
              : null,
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
    programs,
    selectedOrganization,
  } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <UI.Page heading="Product assignments">
      {result?.error && <UI.Banner tone="critical">{result.error}</UI.Banner>}
      {result?.success && (
        <UI.Banner tone="success">{result.message}</UI.Banner>
      )}
      <UI.Section heading="Assign products from a collection">
        <UI.Paragraph>
          Assign the collection’s current products in one step. Products added
          or removed later do not change these assignments. Existing product or
          variant assignments are preserved and reported as skipped.
        </UI.Paragraph>
        <Form method="get">
          <input type="hidden" name="q" value={q} />
          <input
            type="hidden"
            name="organizationId"
            value={selectedOrganization}
          />
          <UI.Grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
            <UI.TextField label="Search collections" name="cq" value={cq} />
            <UI.Button type="submit">Search collections</UI.Button>
          </UI.Grid>
        </Form>
        {collections.nodes.length ? (
          <Form method="get">
            <input type="hidden" name="q" value={q} />
            <input type="hidden" name="cq" value={cq} />
            <input
              type="hidden"
              name="organizationId"
              value={selectedOrganization}
            />
            <UI.Stack gap="base">
              <UI.Select
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
                    <UI.Option value={selectedCollection.collectionGid}>
                      {selectedCollection.title}
                    </UI.Option>
                  )}
                {collections.nodes.map((c) => (
                  <UI.Option key={c.id} value={c.id}>
                    {c.title}
                  </UI.Option>
                ))}
              </UI.Select>
              <UI.Button type="submit" disabled={busy}>
                Preview collection
              </UI.Button>
            </UI.Stack>
          </Form>
        ) : (
          <UI.Paragraph>No matching collections.</UI.Paragraph>
        )}
        {collections.pageInfo.hasNextPage && (
          <UI.AdminLink
            href={`/app/products?${new URLSearchParams({ q, cq, cafter: collections.pageInfo.endCursor! })}`}
          >
            Next collections page
          </UI.AdminLink>
        )}
        {previewError && <UI.Banner tone="critical">{previewError}</UI.Banner>}
        {selectedCollection && (
          <UI.Section
            heading={`${selectedCollection.title} · ${selectedCollection.products.length} current products`}
          >
            {selectedCollection.products.length ? (
              <>
                <UI.List>
                  {selectedCollection.products.slice(0, 20).map((p) => (
                    <UI.ListItem key={p.id}>{p.title}</UI.ListItem>
                  ))}
                </UI.List>
                {selectedCollection.products.length > 20 && (
                  <UI.Paragraph>
                    Showing the first 20 products. All{" "}
                    {selectedCollection.products.length} current products will
                    be considered.
                  </UI.Paragraph>
                )}
                <UI.Paragraph>
                  Membership is read again when you save. Existing assignments
                  are skipped; all eligible products are saved together.
                </UI.Paragraph>
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
                    <UI.Stack gap="base">
                      <ProgramSelect programs={programs} />
                      <UI.Select
                        label="Collection affiliate"
                        name="organizationId"
                        value={selectedOrganization}
                      >
                        {organizations.map((o) => (
                          <UI.Option key={o.id} value={o.id}>
                            {o.name}
                          </UI.Option>
                        ))}
                      </UI.Select>
                      <UI.TextField
                        label="Collection effective from (UTC)"
                        name="effectiveFrom"
                        required
                        placeholder="2026-11-01T00:00:00Z"
                        details="Future ISO timestamp ending in Z."
                      />
                      <UI.Button
                        type="submit"
                        variant="primary"
                        disabled={busy}
                      >
                        Assign current collection products
                      </UI.Button>
                    </UI.Stack>
                  </Form>
                ) : (
                  <UI.Paragraph>
                    Create an active organization before assigning products.
                  </UI.Paragraph>
                )}
              </>
            ) : (
              <UI.Paragraph>
                This collection is empty. No products can be assigned.
              </UI.Paragraph>
            )}
          </UI.Section>
        )}
      </UI.Section>
      <UI.Section heading="Search Shopify catalog">
        <Form method="get">
          <input
            type="hidden"
            name="organizationId"
            value={selectedOrganization}
          />
          <UI.Grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
            <UI.TextField
              label="Search products and variants"
              name="q"
              value={q}
            />
            <UI.Button type="submit">Search</UI.Button>
          </UI.Grid>
        </Form>
        {!catalog.nodes.length && (
          <UI.Paragraph>No matching merchandise.</UI.Paragraph>
        )}
        {catalog.nodes.length > 0 && (
          <details className="admin-details">
            <summary>View {catalog.nodes.length} catalog variants</summary>
            <UI.List>
              {catalog.nodes.map((v) => (
                <UI.ListItem key={v.id}>
                  {v.product.title} / {v.title}
                </UI.ListItem>
              ))}
            </UI.List>
          </details>
        )}
        {catalog.pageInfo.hasNextPage && (
          <UI.AdminLink
            href={`/app/products?q=${encodeURIComponent(q)}&after=${encodeURIComponent(catalog.pageInfo.endCursor!)}`}
          >
            Next catalog page
          </UI.AdminLink>
        )}
      </UI.Section>
      <UI.Section heading="Assign merchandise">
        <UI.Paragraph>
          Variant assignments take precedence over product assignments. Saving
          replaces the current assignment for the same target from the specified
          time, preserving its history.
        </UI.Paragraph>
        {organizations.length > 0 && catalog.nodes.length > 0 ? (
          <Form method="post">
            <input type="hidden" name="intent" value="assign" />
            <UI.Stack gap="base">
              <ProgramSelect programs={programs} />
              <UI.Select label="Product or variant" name="targetGid">
                {Array.from(
                  new Map(
                    catalog.nodes.map((v) => [v.product.id, v.product]),
                  ).values(),
                ).map((p) => (
                  <UI.Option key={p.id} value={p.id}>
                    {p.title} — All variants
                  </UI.Option>
                ))}
                {catalog.nodes.map((v) => (
                  <UI.Option key={v.id} value={v.id}>
                    {v.product.title} / {v.title}
                  </UI.Option>
                ))}
              </UI.Select>
              <UI.Select
                label="Affiliate"
                name="organizationId"
                value={selectedOrganization}
              >
                {organizations.map((o) => (
                  <UI.Option key={o.id} value={o.id}>
                    {o.name}
                  </UI.Option>
                ))}
              </UI.Select>
              <UI.TextField
                label="Effective from (UTC)"
                name="effectiveFrom"
                required
                placeholder="2026-11-01T00:00:00Z"
                details="Future ISO timestamp ending in Z."
              />
              <UI.Button type="submit" variant="primary" disabled={busy}>
                Save assignment
              </UI.Button>
            </UI.Stack>
          </Form>
        ) : (
          <UI.Paragraph>
            Create an active organization and find a catalog product before
            assigning merchandise.
          </UI.Paragraph>
        )}
      </UI.Section>
      <UI.Section heading="Assignment history">
        <UI.Table>
          <UI.TableHeaderRow>
            <UI.TableHeader>Merchandise</UI.TableHeader>
            <UI.TableHeader>Organization</UI.TableHeader>
            <UI.TableHeader>From (UTC)</UI.TableHeader>
            <UI.TableHeader>Until (UTC)</UI.TableHeader>
            <UI.TableHeader>Action</UI.TableHeader>
          </UI.TableHeaderRow>
          <UI.TableBody>
            {assignments.map((a) => (
              <UI.TableRow key={a.id}>
                <UI.TableCell>
                  {a.displayTitle} · {a.variantGid ? "Variant" : "Product"}
                  {a.programVersion && ` · ${a.programVersion.label}`}
                </UI.TableCell>
                <UI.TableCell>{a.organization.name}</UI.TableCell>
                <UI.TableCell>
                  {new Date(a.effectiveFrom).toISOString()}
                </UI.TableCell>
                <UI.TableCell>
                  {a.effectiveTo
                    ? new Date(a.effectiveTo).toISOString()
                    : "Ongoing"}
                </UI.TableCell>
                <UI.TableCell>
                  {new Date(a.effectiveFrom) < new Date() &&
                    (!a.effectiveTo ||
                      new Date(a.effectiveTo) > new Date()) && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="retire" />
                        <input type="hidden" name="assignmentId" value={a.id} />
                        <UI.Button type="submit" disabled={busy}>
                          Retire now
                        </UI.Button>
                      </Form>
                    )}
                </UI.TableCell>
              </UI.TableRow>
            ))}
          </UI.TableBody>
        </UI.Table>
      </UI.Section>
    </UI.Page>
  );
}

function ProgramSelect({
  programs,
}: {
  programs: { id: string; label: string }[];
}) {
  return (
    <UI.Select label="Commission program" name="programVersionId">
      <UI.Option value="">
        Legacy organization rate (seed/internal teams only)
      </UI.Option>
      {programs.map((p) => (
        <UI.Option key={p.id} value={p.id}>
          {p.label}
        </UI.Option>
      ))}
    </UI.Select>
  );
}
