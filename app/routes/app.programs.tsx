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
    <s-stack gap="base">
      <s-text-field
        label="Program name"
        name="name"
        value={name ?? ""}
        required
      />
      <s-select label="Commission type" name="kind">
        <s-option value="percentage">
          Percentage of merchandise revenue
        </s-option>
        <s-option value="fixed_item">Fixed amount per item</s-option>
      </s-select>
      <s-text-field
        label={`Percentage or ${currency} amount per item`}
        name="amount"
        required
      />
      <s-button type="submit" variant="primary">
        Save new program version
      </s-button>
    </s-stack>
  );
}
export default function Programs() {
  const { programs, currency } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <s-page heading="Commission programs">
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
      {result?.success && (
        <s-banner tone="success">Program version saved.</s-banner>
      )}
      <s-section heading="Create program">
        <s-paragraph>
          Percentage commissions use merchandise after discounts. Fixed amounts
          pay per item, capped at discounted merchandise revenue; free items
          earn zero. Refunds reverse the original commission proportionally.
          Existing assignments keep their selected version.
        </s-paragraph>
        <Form method="post">
          <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
            <ProgramFields currency={currency} />
          </fieldset>
        </Form>
      </s-section>
      {programs.map((p) => (
        <s-section key={p.id} heading={p.name}>
          <s-unordered-list>
            {p.versions.map((v) => (
              <s-list-item key={v.id}>
                {v.label} ·{" "}
                {v.kind === "percentage"
                  ? `${v.rateBps / 100}%`
                  : `${formatMinor(v.fixedMinor!, v.currency)} per item`}{" "}
                · created {new Date(v.createdAt).toISOString()}
              </s-list-item>
            ))}
          </s-unordered-list>
          <Form method="post">
            <input type="hidden" name="programId" value={p.id} />
            <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
              <ProgramFields name={p.name} currency={currency} />
            </fieldset>
          </Form>
        </s-section>
      ))}
    </s-page>
  );
}
