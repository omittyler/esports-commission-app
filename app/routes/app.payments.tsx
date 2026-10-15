import type { LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { requireAdmin } from "../services/auth.server";
import db from "../db.server";
import * as UI from "../components/AdminUI";
import { CommissionBalances } from "../components/PaymentReport";
import { formatMinor } from "../services/money";

export const headers = () => ({
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
});
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const [organizations, earned, paid] = await db.$transaction(
    [
      db.organization.findMany({
        select: {
          id: true,
          name: true,
          account: { select: { id: true, status: true } },
        },
        orderBy: { name: "asc" },
      }),
      db.commissionTransaction.groupBy({
        by: ["organizationId", "currency"],
        orderBy: { organizationId: "asc" },
        _sum: { commissionMinor: true },
      }),
      db.commissionPayment.groupBy({
        by: ["organizationId", "currency"],
        orderBy: { organizationId: "asc" },
        where: { void: null },
        _sum: { amountMinor: true },
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  const totals = new Map<
    string,
    { commission: bigint; paid: bigint; due: bigint; credit: bigint }
  >();
  const rows = organizations.flatMap((org) => {
    const currencies = new Set([
      ...earned
        .filter((e) => e.organizationId === org.id)
        .map((e) => e.currency),
      ...paid.filter((p) => p.organizationId === org.id).map((p) => p.currency),
    ]);
    if (org.account && !currencies.size)
      currencies.add(process.env.SHOP_CURRENCY || "USD");
    return [...currencies].map((currency) => {
      const commission =
        earned.find(
          (e) => e.organizationId === org.id && e.currency === currency,
        )?._sum?.commissionMinor ?? 0n;
      const payment =
        paid.find((p) => p.organizationId === org.id && p.currency === currency)
          ?._sum?.amountMinor ?? 0n;
      const outstanding = commission - payment;
      const total = totals.get(currency) ?? {
        commission: 0n,
        paid: 0n,
        due: 0n,
        credit: 0n,
      };
      total.commission += commission;
      total.paid += payment;
      if (outstanding > 0n) total.due += outstanding;
      else total.credit -= outstanding;
      totals.set(currency, total);
      return {
        id: `${org.id}:${currency}`,
        name: org.name,
        accountId: org.account?.id,
        status: org.account?.status ?? "Internal organization",
        currency,
        earned: commission.toString(),
        paid: payment.toString(),
        outstanding: outstanding.toString(),
      };
    });
  });
  if (!totals.size)
    totals.set(process.env.SHOP_CURRENCY || "USD", {
      commission: 0n,
      paid: 0n,
      due: 0n,
      credit: 0n,
    });
  return data(
    {
      rows,
      totals: [...totals].map(([currency, t]) => ({
        currency,
        commission: t.commission.toString(),
        paid: t.paid.toString(),
        outstanding: (t.commission - t.paid).toString(),
        base: "0",
        sold: 0,
        refunded: 0,
        due: t.due.toString(),
        credit: t.credit.toString(),
      })),
    },
    { headers: headers() },
  );
}
export default function Payments() {
  const { rows, totals } = useLoaderData<typeof loader>();
  return (
    <UI.Page heading="Commissions & payments">
      <CommissionBalances totals={totals} />
      {totals.map((t) => (
        <UI.Paragraph key={t.currency}>
          Payable to affiliates: {formatMinor(t.due, t.currency)} · Refund
          credits carried forward: {formatMinor(t.credit, t.currency)}. Credits
          stay with their affiliate.
        </UI.Paragraph>
      ))}
      <UI.Section heading="Affiliate balances">
        <UI.Paragraph>
          Open an affiliate to record a completed payment or review the
          commissions it covers.
        </UI.Paragraph>
        {!rows.length ? (
          <UI.Paragraph>
            No commission activity or affiliate accounts yet.
          </UI.Paragraph>
        ) : (
          <UI.Table>
            <UI.TableHeaderRow>
              {[
                "Affiliate",
                "Account status",
                "Earned",
                "Payments recorded",
                "Outstanding / credit",
              ].map((h) => (
                <UI.TableHeader key={h}>{h}</UI.TableHeader>
              ))}
            </UI.TableHeaderRow>
            <UI.TableBody>
              {rows.map((r) => (
                <UI.TableRow key={r.id}>
                  <UI.TableCell>
                    <UI.AdminLink
                      href={
                        r.accountId
                          ? `/app/affiliates/${r.accountId}`
                          : `/app/organizations/${r.id.split(":")[0]}`
                      }
                    >
                      {r.name}
                    </UI.AdminLink>
                  </UI.TableCell>
                  <UI.TableCell>{r.status}</UI.TableCell>
                  <UI.TableCell>
                    {formatMinor(r.earned, r.currency)}
                  </UI.TableCell>
                  <UI.TableCell>{formatMinor(r.paid, r.currency)}</UI.TableCell>
                  <UI.TableCell>
                    {formatMinor(r.outstanding, r.currency)}
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
