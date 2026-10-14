import * as UI from "../components/AdminUI";
import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return null;
}
export default function Home() {
  return (
    <UI.Page heading="Merchandise commissions">
      <UI.Section heading="Manage partner merchandise">
        <UI.Stack gap="base">
          <UI.Paragraph>
            Set up partner organizations, schedule commission rates, and assign
            Shopify merchandise.
          </UI.Paragraph>
          <UI.AdminLink href="/app/organizations">Organizations</UI.AdminLink>
          <UI.AdminLink href="/app/affiliates">
            Affiliates and applications
          </UI.AdminLink>
          <UI.AdminLink href="/app/programs">Commission programs</UI.AdminLink>
          <UI.AdminLink href="/app/products">Product assignments</UI.AdminLink>
        </UI.Stack>
      </UI.Section>
      <UI.Section heading="Financial definitions">
        <UI.Paragraph>
          Merchandise base is revenue after discounts, excluding tax and
          shipping. Commission entries preserve the rate and organization at
          sale time. Refunds append reversals against that original sale.
        </UI.Paragraph>
        <UI.Paragraph>
          Manage affiliates and commission programs, then use Order ingestion to
          populate partner sales and order reports.
        </UI.Paragraph>
      </UI.Section>
    </UI.Page>
  );
}
