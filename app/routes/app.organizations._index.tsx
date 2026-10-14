import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useActionData, useLoaderData } from "react-router";
import db from "../db.server";
import { requireAdmin } from "../services/auth.server";
import { actionError, createOrganization } from "../services/admin.server";
import { CreateOrganizationForm } from "../components/OrganizationForm";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const now = new Date();
  return {
    organizations: await db.organization.findMany({
      orderBy: { name: "asc" },
      include: {
        rates: {
          where: {
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
        },
      },
    }),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await requireAdmin(request);
  try {
    const org = await createOrganization(
      await request.formData(),
      session.shop,
    );
    return redirect(`/app/organizations/${org.id}`);
  } catch (error) {
    return data({ error: actionError(error) }, { status: 400 });
  }
}
export default function Organizations() {
  const { organizations } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <s-page heading="Organizations">
      <s-section heading="Partner organizations">
        {organizations.length === 0 ? (
          <s-paragraph>
            Create your first organization to begin assigning merchandise.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Name</s-table-header>
              <s-table-header>Slug</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Current commission</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {organizations.map((org) => (
                <s-table-row key={org.id}>
                  <s-table-cell>
                    <s-link href={`/app/organizations/${org.id}`}>
                      {org.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{org.slug}</s-table-cell>
                  <s-table-cell>
                    <s-badge
                      tone={org.status === "active" ? "success" : "neutral"}
                    >
                      {org.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {org.rates[0]
                      ? `${(org.rates[0].rateBps / 100).toFixed(2)}%`
                      : "No current rate"}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
      <s-section heading="Create organization">
        {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
        <CreateOrganizationForm />
      </s-section>
    </s-page>
  );
}
