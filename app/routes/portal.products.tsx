import type { LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
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
export default function Products() {
  const { name, report } = useLoaderData<typeof loader>();
  const assignedMerchandise = [
    ...new Set(report.assignments.map((a) => a.collection ?? a.title)),
  ].sort((a, b) => a.localeCompare(b));
  return (
    <PortalLayout title={`${name} products`}>
      <a href="/portal/dashboard">Dashboard and orders</a>
      <h2>Assigned merchandise</h2>
      {!report.assignments.length && <p>No merchandise assigned yet.</p>}
      <ul>
        {assignedMerchandise.map((title) => (
          <li key={title}>{title}</li>
        ))}
      </ul>
      <h2>Product performance</h2>
      <table>
        <thead>
          <tr>
            <th>Product / variant</th>
            <th>Sold</th>
            <th>Refunded</th>
            <th>Net merchandise</th>
            <th>Commission</th>
          </tr>
        </thead>
        <tbody>
          {report.products.map((p) => (
            <tr key={p.key}>
              <td>{p.title}</td>
              <td>{p.sold}</td>
              <td>{p.refunded}</td>
              <td>{formatMinor(p.base, p.currency)}</td>
              <td>{formatMinor(p.commission, p.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PortalLayout>
  );
}
