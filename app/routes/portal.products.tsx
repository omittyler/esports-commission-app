import type { LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { requirePartner } from "../services/affiliates/auth.server";
import { affiliateReport } from "../services/affiliates/reporting.server";
import { formatMinor } from "../services/money";
import {
  PortalEmptyState,
  PortalIcon,
  PortalLayout,
} from "../components/PortalLayout";
import { unauthenticated } from "../shopify.server";
import { collectionStorefrontLinks } from "../services/shopify/collection-links.server";
export const headers = () => ({
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
});
export async function loader({ request }: LoaderFunctionArgs) {
  const partner = await requirePartner(request);
  const report = await affiliateReport(partner.organizationId);
  const ids = report.assignments.flatMap((a) =>
    a.collectionGid ? [a.collectionGid] : [],
  );
  let links = new Map<string, string>();
  if (ids.length && process.env.SHOPIFY_SHOP) {
    try {
      const { admin } = await unauthenticated.admin(process.env.SHOPIFY_SHOP);
      links = await collectionStorefrontLinks(
        (query, options) => admin.graphql(query, options),
        ids,
      );
    } catch {
      // A storefront lookup must never hide the affiliate's financial report.
      console.warn("Partner collection links are temporarily unavailable");
    }
  }
  const merchandise = [
    ...new Map(
      report.assignments.map((a) => {
        const key = a.collectionGid ?? a.collection ?? a.title;
        return [
          key,
          {
            key,
            title: a.collection ?? a.title,
            collection: !!a.collection,
            url: a.collectionGid ? (links.get(a.collectionGid) ?? null) : null,
          },
        ] as const;
      }),
    ).values(),
  ].sort((a, b) => a.title.localeCompare(b.title));
  return data(
    {
      name: partner.displayName,
      report,
      merchandise,
    },
    { headers: headers() },
  );
}
export default function Products() {
  const { name, report, merchandise } = useLoaderData<typeof loader>();
  return (
    <PortalLayout
      title="Your collections"
      description="Your merchandise, your community, your results."
      partnerName={name}
      activePage="products"
    >
      <section className="portal-section" aria-labelledby="assigned-heading">
        <div className="section-heading">
          <div>
            <h2 id="assigned-heading">Assigned merchandise</h2>
            <p>Explore your collections on the Crafted storefront.</p>
          </div>
          <span className="section-count">
            {merchandise.length}{" "}
            {merchandise.every((item) => item.collection)
              ? merchandise.length === 1
                ? "collection"
                : "collections"
              : merchandise.length === 1
                ? "assignment"
                : "assignments"}
          </span>
        </div>
        {!merchandise.length ? (
          <PortalEmptyState title="Your collection is up next">
            Crafted will assign your merchandise here once your collection is
            ready.
          </PortalEmptyState>
        ) : (
          <div className="collection-grid">
            {merchandise.map((item) => (
              <article className="collection-card" key={item.key}>
                <span className="collection-icon">
                  <PortalIcon name="collection" />
                </span>
                <p className="eyebrow">
                  {item.collection ? "YOUR COLLECTION" : "YOUR MERCHANDISE"}
                </p>
                <h3>{item.title}</h3>
                {item.url ? (
                  <a
                    className="portal-button"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View ${item.title} on Crafted (opens in a new tab)`}
                  >
                    View collection <PortalIcon name="arrow" />
                  </a>
                ) : item.collection ? (
                  <span className="collection-unavailable">
                    Collection link unavailable
                  </span>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="portal-section" aria-labelledby="performance-heading">
        <div className="section-heading">
          <div>
            <h2 id="performance-heading">Product performance</h2>
            <p>Units sold, returns, and commissions for your merchandise.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Product / variant</th>
                <th>Sold</th>
                <th>Refunded</th>
                <th className="amount">Net merchandise</th>
                <th className="amount">Commission</th>
              </tr>
            </thead>
            <tbody>
              {report.products.map((p) => (
                <tr key={p.key}>
                  <td>{p.title}</td>
                  <td>{p.sold}</td>
                  <td>{p.refunded}</td>
                  <td className="amount">{formatMinor(p.base, p.currency)}</td>
                  <td className="amount">
                    {formatMinor(p.commission, p.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!report.products.length && (
          <PortalEmptyState title="No product sales yet">
            Once your merchandise sells, you’ll see units sold, returns, and
            commission earned here.
          </PortalEmptyState>
        )}
      </section>
    </PortalLayout>
  );
}
