import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return null;
}
export default function Home() {
  return (
    <s-page heading="Merchandise commissions">
      <s-section heading="Manage partner merchandise">
        <s-stack gap="base">
          <s-paragraph>
            Set up partner organizations, schedule commission rates, and assign
            Shopify merchandise.
          </s-paragraph>
          <s-link href="/app/organizations">Organizations</s-link>
          <s-link href="/app/affiliates">Affiliates and applications</s-link>
          <s-link href="/app/programs">Commission programs</s-link>
          <s-link href="/app/products">Product assignments</s-link>
        </s-stack>
      </s-section>
      <s-section heading="Financial definitions">
        <s-paragraph>
          Merchandise base is revenue after discounts, excluding tax and
          shipping. Commission entries preserve the rate and organization at
          sale time. Refunds append reversals against that original sale.
        </s-paragraph>
        <s-paragraph>
          Manage affiliates and commission programs, then use Order ingestion to
          populate partner sales and order reports.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
