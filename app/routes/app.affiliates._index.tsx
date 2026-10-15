import * as UI from "../components/AdminUI";
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
    <UI.Page heading="Affiliates">
      {!configured && (
        <UI.Banner tone="warning">
          Registration is not open yet. Connect email sign-in before inviting
          affiliates.
        </UI.Banner>
      )}
      <UI.Section heading="Partner registration">
        <UI.Paragraph>
          Organizations and creators register and verify their email, then wait
          for your approval.
        </UI.Paragraph>
        <UI.AdminLink href={registrationUrl} target="_blank">
          Open registration page
        </UI.AdminLink>
      </UI.Section>
      <UI.Section heading="Applications and affiliates">
        {!accounts.length ? (
          <UI.Paragraph>
            {configured
              ? "No applications yet. Share the registration page with your partners."
              : "No applications yet. You can preview the registration form while email sign-in is being configured."}
          </UI.Paragraph>
        ) : (
          <UI.Table>
            <UI.TableHeaderRow>
              <UI.TableHeader>Affiliate</UI.TableHeader>
              <UI.TableHeader>Type</UI.TableHeader>
              <UI.TableHeader>Contact</UI.TableHeader>
              <UI.TableHeader>Status</UI.TableHeader>
              <UI.TableHeader>Email verified</UI.TableHeader>
            </UI.TableHeaderRow>
            <UI.TableBody>
              {accounts.map((a) => (
                <UI.TableRow key={a.id}>
                  <UI.TableCell>
                    <UI.AdminLink href={`/app/affiliates/${a.id}`}>
                      {a.displayName}
                    </UI.AdminLink>
                  </UI.TableCell>
                  <UI.TableCell>{a.type}</UI.TableCell>
                  <UI.TableCell>
                    {a.firstName} {a.lastName} · {a.email}
                  </UI.TableCell>
                  <UI.TableCell>{a.status}</UI.TableCell>
                  <UI.TableCell>
                    {a.verifiedAt ? "Yes" : "Awaiting verification"}
                  </UI.TableCell>
                </UI.TableRow>
              ))}
            </UI.TableBody>
          </UI.Table>
        )}
      </UI.Section>
    </UI.Page>
  );
}
