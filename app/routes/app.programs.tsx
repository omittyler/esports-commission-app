import * as UI from "../components/AdminUI";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  data,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { requireAdmin } from "../services/auth.server";
import { actionError } from "../services/admin.server";
import { saveProgram } from "../services/affiliates/admin.server";
import { formatMinor } from "../services/money";
import db from "../db.server";
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const programs = await db.commissionProgram.findMany({
    include: { versions: { orderBy: { createdAt: "desc" } } },
    orderBy: { name: "asc" },
  });
  return {
    programs: programs.map((p) => ({
      ...p,
      versions: p.versions.map((v) => ({
        ...v,
        fixedMinor: v.fixedMinor?.toString() ?? null,
      })),
    })),
    currency: process.env.SHOP_CURRENCY || "USD",
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await requireAdmin(request);
  try {
    await saveProgram(await request.formData(), session.shop);
    return { error: null, success: true };
  } catch (error) {
    return data({ error: actionError(error), success: false }, { status: 400 });
  }
}
function ProgramFields({
  name,
  currency,
}: {
  name?: string;
  currency: string;
}) {
  return (
    <UI.Stack gap="base">
      <UI.TextField
        label="Program name"
        name="name"
        value={name ?? ""}
        required
      />
      <UI.Select label="Commission type" name="kind">
        <UI.Option value="percentage">
          Percentage of merchandise revenue
        </UI.Option>
        <UI.Option value="fixed_item">Fixed amount per item</UI.Option>
      </UI.Select>
      <UI.TextField
        label={`Percentage or ${currency} amount per item`}
        name="amount"
        required
      />
      <UI.Button type="submit" variant="primary">
        Save new program version
      </UI.Button>
    </UI.Stack>
  );
}
export default function Programs() {
  const { programs, currency } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <UI.Page heading="Commission programs">
      {result?.error && <UI.Banner tone="critical">{result.error}</UI.Banner>}
      {result?.success && (
        <UI.Banner tone="success">Program version saved.</UI.Banner>
      )}
      <UI.Section heading="Create program">
        <UI.Paragraph>
          Percentage commissions use merchandise after discounts. Fixed amounts
          pay per item, capped at discounted merchandise revenue; free items
          earn zero. Refunds reverse the original commission proportionally.
          Existing assignments keep their selected version.
        </UI.Paragraph>
        <Form method="post">
          <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
            <ProgramFields currency={currency} />
          </fieldset>
        </Form>
      </UI.Section>
      {programs.map((p) => (
        <UI.Section key={p.id} heading={p.name}>
          <UI.List>
            {p.versions.map((v) => (
              <UI.ListItem key={v.id}>
                {v.label} ·{" "}
                {v.kind === "percentage"
                  ? `${v.rateBps / 100}%`
                  : `${formatMinor(v.fixedMinor!, v.currency)} per item`}{" "}
                · created {new Date(v.createdAt).toISOString()}
              </UI.ListItem>
            ))}
          </UI.List>
          <Form method="post">
            <input type="hidden" name="programId" value={p.id} />
            <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
              <ProgramFields name={p.name} currency={currency} />
            </fieldset>
          </Form>
        </UI.Section>
      ))}
    </UI.Page>
  );
}
