import type { LoaderFunctionArgs } from "react-router";
import { Form, data, useLoaderData } from "react-router";
import { requirePartner } from "../services/affiliates/auth.server";
import { affiliateReport } from "../services/affiliates/reporting.server";
import { formatMinor } from "../services/money";
import { PortalLayout } from "../components/PortalLayout";
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
    },
    { headers: headers() },
  );
}
export default function Dashboard() {
  const { name, report } = useLoaderData<typeof loader>();
  return (
    <PortalLayout title={`${name} dashboard`}>
      <a href="/portal/products">Your products</a>
      <Form action="/portal/logout" method="post">
        <button type="submit">Sign out</button>
      </Form>
      {!report.totals.length && (
        <p>No qualifying sales have been recorded yet.</p>
      )}
      <div className="metrics">
        {report.totals.map((t) => (
          <div key={t.currency} className="metric">
            <p>Merchandise revenue after refunds</p>
            <strong>{formatMinor(t.base, t.currency)}</strong>
            <p>Commission earned: {formatMinor(t.commission, t.currency)}</p>
            <p>
              {t.sold} units sold · {t.refunded} units refunded
            </p>
          </div>
        ))}
      </div>
      <h2>Orders earning commission</h2>
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Date (UTC)</th>
            <th>Your merchandise</th>
            <th>Units sold / refunded</th>
            <th>Net merchandise</th>
            <th>Commission after refunds</th>
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
              <td>{formatMinor(o.base, o.currency)}</td>
              <td>{formatMinor(o.commission, o.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Commission activity</h2>
      <table>
        <thead>
          <tr>
            <th>Date (UTC)</th>
            <th>Order</th>
            <th>Product</th>
            <th>Type</th>
            <th>Commission</th>
          </tr>
        </thead>
        <tbody>
          {report.ledger.map((e) => (
            <tr key={e.id}>
              <td>{e.date.slice(0, 10)}</td>
              <td>{e.order}</td>
              <td>{e.product}</td>
              <td>{e.type}</td>
              <td>{formatMinor(e.commission, e.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PortalLayout>
  );
}
