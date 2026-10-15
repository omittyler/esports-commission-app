import * as UI from "../components/AdminUI";
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
    <UI.Page heading="Organizations">
      <UI.Section heading="Partner organizations">
        {organizations.length === 0 ? (
          <UI.Paragraph>
            Create your first organization to begin assigning merchandise.
          </UI.Paragraph>
        ) : (
          <UI.Table>
            <UI.TableHeaderRow>
              <UI.TableHeader>Name</UI.TableHeader>
              <UI.TableHeader>Slug</UI.TableHeader>
              <UI.TableHeader>Status</UI.TableHeader>
              <UI.TableHeader>Current commission</UI.TableHeader>
            </UI.TableHeaderRow>
            <UI.TableBody>
              {organizations.map((org) => (
                <UI.TableRow key={org.id}>
                  <UI.TableCell>
                    <UI.AdminLink href={`/app/organizations/${org.id}`}>
                      {org.name}
                    </UI.AdminLink>
                  </UI.TableCell>
                  <UI.TableCell>{org.slug}</UI.TableCell>
                  <UI.TableCell>
                    <UI.Badge
                      tone={org.status === "active" ? "success" : "neutral"}
                    >
                      {org.status}
                    </UI.Badge>
                  </UI.TableCell>
                  <UI.TableCell>
                    {org.rates[0]
                      ? `${(org.rates[0].rateBps / 100).toFixed(2)}%`
                      : "No current rate"}
                  </UI.TableCell>
                </UI.TableRow>
              ))}
            </UI.TableBody>
          </UI.Table>
        )}
      </UI.Section>
      <UI.Section heading="Create organization">
        {result?.error && <UI.Banner tone="critical">{result.error}</UI.Banner>}
        <CreateOrganizationForm />
      </UI.Section>
    </UI.Page>
  );
}
