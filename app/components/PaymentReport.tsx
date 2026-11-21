import { formatMinor } from "../services/money";
import type { affiliateReport } from "../services/affiliates/reporting.server";
type Report = Awaited<ReturnType<typeof affiliateReport>>;

export function CommissionBalances({
  totals,
}: {
  totals: (Report["totals"][number] & { due?: string; credit?: string })[];
}) {
  return (
    <>
      {totals.map((t) => (
        <div
          className={`metric-grid payment-metrics ${t.credit !== undefined ? "payment-overview-metrics" : ""}`}
          key={t.currency}
        >
          <div className="metric-card">
            <p className="metric-label">Commission earned</p>
            <strong className="metric-value">
              {formatMinor(t.commission, t.currency)}
            </strong>
            <p className="metric-note">After refund reversals</p>
          </div>
          <div className="metric-card">
            <p className="metric-label">Payments recorded</p>
            <strong className="metric-value">
              {formatMinor(t.paid, t.currency)}
            </strong>
            <p className="metric-note">Excludes void recording corrections</p>
          </div>
          <div className="metric-card accent">
            <p className="metric-label">
              {t.due !== undefined
                ? "Payable to affiliates"
                : BigInt(t.outstanding) < 0n
                  ? "Refund credit carried forward"
                  : "Outstanding commission"}
            </p>
            <strong className="metric-value">
              {formatMinor(
                t.due !== undefined
                  ? t.due
                  : BigInt(t.outstanding) < 0n
                    ? -BigInt(t.outstanding)
                    : t.outstanding,
                t.currency,
              )}
            </strong>
            <p className="metric-note">
              {t.due !== undefined
                ? "Positive balances only"
                : BigInt(t.outstanding) < 0n
                  ? "Deducted from future commissions"
                  : "Earned less recorded payments"}
            </p>
          </div>
          {t.credit !== undefined && (
            <div className="metric-card">
              <p className="metric-label">Refund credits</p>
              <strong className="metric-value">
                {formatMinor(t.credit, t.currency)}
              </strong>
              <p className="metric-note">Kept with the earning affiliate</p>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

export function PaymentHistory({ payments }: { payments: Report["payments"] }) {
  return (
    <section className="portal-section">
      <div className="section-heading">
        <div>
          <h2>Payment history</h2>
          <p>
            Payments recorded by Crafted, with the commissions and refund
            credits they cover.
          </p>
        </div>
      </div>
      {!payments.length ? (
        <div className="payment-empty">No payments recorded yet.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date (UTC)</th>
                <th>Method / reference</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Commission details</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.paidAt.slice(0, 10)}</td>
                  <td>
                    {p.method}
                    <br />
                    {p.reference}
                  </td>
                  <td className="amount">
                    {formatMinor(p.amount, p.currency)}
                  </td>
                  <td>
                    {p.void ? (
                      <>
                        <span className="activity-badge refund">
                          Voided record
                        </span>
                        <p>{p.void.reason}</p>
                      </>
                    ) : (
                      <span className="activity-badge">Recorded paid</span>
                    )}
                  </td>
                  <td>
                    <details>
                      <summary>View commissions</summary>
                      <p>PayPal contact at recording: {p.payeeEmail}</p>
                      <ul>
                        {p.allocations.map((a) => (
                          <li key={a.id}>
                            {a.order} · {a.product} ·{" "}
                            {formatMinor(a.amount, p.currency)}
                            {BigInt(a.amount) < 0n ? " refund credit" : ""}
                          </li>
                        ))}
                      </ul>
                      <p>Recorded {p.recordedAt.slice(0, 10)} (UTC)</p>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function CommissionPaymentTable({
  orders,
}: {
  orders: Report["orders"];
}) {
  return (
    <section className="portal-section">
      <div className="section-heading">
        <div>
          <h2>Commission payment status</h2>
          <p>Order balances include refunds. Credits reduce future payments.</p>
        </div>
      </div>
      {!orders.length ? (
        <div className="payment-empty">No qualifying commissions yet.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Commission earned</th>
                <th>Settled by payments / credits</th>
                <th>Outstanding / credit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.key}>
                  <td>{o.name}</td>
                  <td className="amount">
                    {formatMinor(o.commission, o.currency)}
                  </td>
                  <td className="amount">{formatMinor(o.paid, o.currency)}</td>
                  <td className="amount">
                    {formatMinor(o.outstanding, o.currency)}
                  </td>
                  <td>
                    <span
                      className={`activity-badge ${o.paymentStatus === "Refund credit" ? "refund" : ""}`}
                    >
                      {o.paymentStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
