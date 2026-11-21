import type { LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { requirePartner } from "../services/affiliates/auth.server";
import { affiliateReport } from "../services/affiliates/reporting.server";
import { PortalLayout } from "../components/PortalLayout";
import {
  CommissionBalances,
  CommissionPaymentTable,
  PaymentHistory,
} from "../components/PaymentReport";
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
export default function Payments() {
  const { name, report, currency } = useLoaderData<typeof loader>();
  const totals = report.totals.length
    ? report.totals
    : [
        {
          currency,
          base: "0",
          commission: "0",
          paid: "0",
          outstanding: "0",
          sold: 0,
          refunded: 0,
        },
      ];
  return (
    <PortalLayout
      title="Payments"
      description="Your earned commissions, recorded payments, and remaining balance."
      partnerName={name}
      activePage="payments"
    >
      <CommissionBalances totals={totals} />
      <CommissionPaymentTable orders={report.orders} />
      <PaymentHistory payments={report.payments} />
    </PortalLayout>
  );
}
