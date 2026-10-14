import type { LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { requirePartner } from "../services/affiliates/auth.server";
import { affiliateReport } from "../services/affiliates/reporting.server";
import { formatMinor } from "../services/money";
import { PortalEmptyState, PortalLayout } from "../components/PortalLayout";
export const headers = () => ({
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
});
export async function loader({ request }: LoaderFunctionArgs) {
  const partner = await requirePartner(request);
  return data(
    {
      name: partner.displayName,
      report: await affiliateReport(partner.organizationId),
      currency: process.env.SHOP_CURRENCY || "USD",
    },
    { headers: headers() },
  );
}
export default function Dashboard() {
  const { name, report, currency } = useLoaderData<typeof loader>();
  const totals = report.totals.length
    ? report.totals
    : [{ currency, base: "0", commission: "0", sold: 0, refunded: 0 }];
  return (
    <PortalLayout
      title="Dashboard"
      description="A clear view of your sales and commissions."
      partnerName={name}
      activePage="dashboard"
    >
      {totals.map((t) => (
        <div key={t.currency}>
          {totals.length > 1 && <p className="currency-label">{t.currency}</p>}
          <div className="metric-grid">
            <div className="metric-card accent">
              <p className="metric-label">Commission earned</p>
              <strong className="metric-value">
                {formatMinor(t.commission, t.currency)}
              </strong>
              <p className="metric-note">After refund reversals</p>
            </div>
            <div className="metric-card">
              <p className="metric-label">Merchandise revenue</p>
              <strong className="metric-value">
                {formatMinor(t.base, t.currency)}
              </strong>
              <p className="metric-note">After discounts and refunds</p>
            </div>
            <div className="metric-card">
              <p className="metric-label">Units sold</p>
              <strong className="metric-value">
                {t.sold.toLocaleString()}
              </strong>
              <p className="metric-note">
                {t.refunded.toLocaleString()} units refunded
              </p>
            </div>
            <div className="metric-card">
              <p className="metric-label">Qualifying orders</p>
              <strong className="metric-value">
                {report.orders
                  .filter((o) => o.currency === t.currency)
                  .length.toLocaleString()}
              </strong>
              <p className="metric-note">
                Orders with your commission activity
              </p>
            </div>
          </div>
        </div>
      ))}
      <section className="portal-section" aria-labelledby="orders-heading">
        <div className="section-heading">
          <div>
            <h2 id="orders-heading">Orders earning commission</h2>
            <p>Your assigned merchandise in each qualifying order.</p>
          </div>
          <span className="section-count">{report.orders.length} orders</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Date (UTC)</th>
                <th>Your merchandise</th>
                <th>Units sold / refunded</th>
                <th className="amount">Net merchandise</th>
                <th className="amount">Commission</th>
              </tr>
            </thead>
            <tbody>
              {report.orders.map((o) => (
                <tr key={o.key}>
                  <td>{o.name}</td>
                  <td>{o.date.slice(0, 10)}</td>
                  <td>{o.products.join(", ")}</td>
                  <td>
                    {o.sold} / {o.refunded}
                  </td>
                  <td className="amount">{formatMinor(o.base, o.currency)}</td>
                  <td className="amount">
                    {formatMinor(o.commission, o.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!report.orders.length && (
          <PortalEmptyState title="Your first commission is up next">
            Qualifying orders will appear here once your assigned merchandise
            sells.
          </PortalEmptyState>
        )}
      </section>
      <section className="portal-section" aria-labelledby="activity-heading">
        <div className="section-heading">
          <div>
            <h2 id="activity-heading">Commission activity</h2>
            <p>
              Earned commissions and refund reversals, recorded as they happen.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date (UTC)</th>
                <th>Order</th>
                <th>Product</th>
                <th>Type</th>
                <th className="amount">Commission</th>
              </tr>
            </thead>
            <tbody>
              {report.ledger.map((e) => (
                <tr key={e.id}>
                  <td>{e.date.slice(0, 10)}</td>
                  <td>{e.order}</td>
                  <td>{e.product}</td>
                  <td>
                    <span
                      className={`activity-badge ${e.type === "refund" ? "refund" : ""}`}
                    >
                      {e.type === "refund" ? "Refund" : "Sale"}
                    </span>
                  </td>
                  <td className="amount">
                    {formatMinor(e.commission, e.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!report.ledger.length && (
          <PortalEmptyState title="No commission activity yet">
            Your commission history will appear here as orders and refunds are
            processed.
          </PortalEmptyState>
        )}
      </section>
    </PortalLayout>
  );
}
