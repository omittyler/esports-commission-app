import type { LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { requireAdmin } from "../services/auth.server";
import db from "../db.server";
import { portalConfigured } from "../services/affiliates/auth.server";
export const headers = () => ({
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
});
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return data(
    {
      accounts: await db.affiliateAccount.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          displayName: true,
          firstName: true,
          lastName: true,
          email: true,
          status: true,
          verifiedAt: true,
        },
      }),
      configured: portalConfigured(),
      registrationUrl: `${process.env.PORTAL_URL || process.env.SHOPIFY_APP_URL}/portal/register`,
    },
    { headers: headers() },
  );
}
export default function Affiliates() {
  const { accounts, registrationUrl, configured } =
    useLoaderData<typeof loader>();
  return (
    <s-page heading="Affiliates">
      {!configured && (
        <s-banner tone="warning">
          Registration is not open yet. Connect email sign-in before inviting
          affiliates.
        </s-banner>
      )}
      <s-section heading="Partner registration">
        <s-paragraph>
          Organizations and creators register and verify their email, then wait
          for your approval.
        </s-paragraph>
        <s-link href={registrationUrl} target="_blank">
          Open registration page
        </s-link>
      </s-section>
      <s-section heading="Applications and affiliates">
        {!accounts.length ? (
          <s-paragraph>
            {configured
              ? "No applications yet. Share the registration page with your partners."
              : "No applications yet. You can preview the registration form while email sign-in is being configured."}
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Affiliate</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Contact</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Email verified</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {accounts.map((a) => (
                <s-table-row key={a.id}>
                  <s-table-cell>
                    <s-link href={`/app/affiliates/${a.id}`}>
                      {a.displayName}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{a.type}</s-table-cell>
                  <s-table-cell>
                    {a.firstName} {a.lastName} · {a.email}
                  </s-table-cell>
                  <s-table-cell>{a.status}</s-table-cell>
                  <s-table-cell>
                    {a.verifiedAt ? "Yes" : "Awaiting verification"}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
