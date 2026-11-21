import { describe, expect, it } from "vitest";
import {
  calculateSales,
  calculateRefund,
  commission,
  percentageToBps,
  sourceKey,
  type Sale,
} from "../../app/services/commissions/domain";

const date = new Date("2026-01-01T00:00:00Z");
const later = new Date("2026-02-01T00:00:00Z");
const rates = [
  {
    id: "r1",
    organizationId: "alpha",
    rateBps: 2000,
    effectiveFrom: date,
    effectiveTo: later,
  },
  {
    id: "r2",
    organizationId: "alpha",
    rateBps: 2500,
    effectiveFrom: later,
    effectiveTo: null,
  },
  {
    id: "r3",
    organizationId: "bravo",
    rateBps: 1500,
    effectiveFrom: date,
    effectiveTo: null,
  },
];
const assignments = [
  {
    id: "a1",
    organizationId: "alpha",
    productGid: "p1",
    variantGid: null,
    effectiveFrom: date,
    effectiveTo: null,
  },
  {
    id: "a2",
    organizationId: "bravo",
    productGid: "p2",
    variantGid: null,
    effectiveFrom: date,
    effectiveTo: null,
  },
];
const line = {
  lineGid: "l1",
  productGid: "p1",
  variantGid: null,
  quantity: 1,
  grossMinor: 6000n,
  discountMinor: 1000n,
};
const sales = (overrides = {}) =>
  calculateSales({
    orderRef: "o1",
    occurredAt: date,
    currency: "USD",
    lines: [line],
    assignments,
    rates,
    ...overrides,
  });
const refund = (
  sale: Sale,
  amount: bigint,
  priorBase = 0n,
  priorCommission = 0n,
) =>
  calculateRefund({
    sale,
    refundRef: "f1",
    occurredAt: later,
    currency: "USD",
    refundMinor: amount,
    alreadyRefundedMinor: priorBase,
    alreadyReversedMinor: priorCommission,
  });

describe("commission accounting", () => {
  it("calculates percentage commissions", () =>
    expect(commission(10000n, 2000)).toBe(2000n));
  it("subtracts discounts and ignores non-partner lines", () => {
    const result = sales({
      lines: [
        line,
        {
          ...line,
          lineGid: "l2",
          productGid: "generic",
          grossMinor: 4000n,
          discountMinor: 0n,
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].baseMinor).toBe(5000n);
    expect(result[0].commissionMinor).toBe(1000n);
  });
  it("splits mixed organizations", () =>
    expect(
      sales({
        lines: [line, { ...line, lineGid: "l2", productGid: "p2" }],
      }).map((s) => s.organizationId),
    ).toEqual(["alpha", "bravo"]));
  it("keeps rate snapshots, including the exact change boundary", () => {
    const old = sales()[0];
    expect(
      sales({
        occurredAt: later,
        lines: [{ ...line, grossMinor: 10000n, discountMinor: 0n }],
      })[0].commissionMinor,
    ).toBe(2500n);
    expect(old.rateBps).toBe(2000);
    expect(old.commissionMinor).toBe(1000n);
  });
  it("prefers variant assignment", () =>
    expect(
      sales({
        lines: [{ ...line, variantGid: "v1" }],
        assignments: [
          ...assignments,
          { ...assignments[1], id: "a3", productGid: "p1", variantGid: "v1" },
        ],
      })[0].organizationId,
    ).toBe("bravo"));
  it("preserves reassignment history", () => {
    const history = [
      { ...assignments[0], effectiveTo: later },
      { ...assignments[1], productGid: "p1", effectiveFrom: later },
    ];
    expect(sales({ assignments: history })[0].organizationId).toBe("alpha");
    expect(
      sales({ assignments: history, occurredAt: later })[0].organizationId,
    ).toBe("bravo");
  });
  it("reverses partial quantity using normalized merchandise amount", () => {
    const sale = sales({
      lines: [{ ...line, quantity: 2, grossMinor: 10000n, discountMinor: 0n }],
      occurredAt: later,
    })[0];
    expect(refund(sale, 5000n).commissionMinor).toBe(-1250n);
  });
  it("reverses full refunds", () =>
    expect(refund(sales()[0], 5000n).commissionMinor).toBe(-1000n));
  it("rounds many partial refunds to exactly the original commission", () => {
    const sale = sales({
      lines: [{ ...line, grossMinor: 3n, discountMinor: 0n }],
    })[0];
    const a = refund(sale, 1n);
    const b = refund(sale, 1n, 1n, -a.commissionMinor);
    const c = refund(sale, 1n, 2n, -a.commissionMinor - b.commissionMinor);
    expect(a.commissionMinor + b.commissionMinor + c.commissionMinor).toBe(
      -sale.commissionMinor,
    );
  });
  it("rejects excessive refunds, mismatched currency and corrupt history", () => {
    expect(() => refund(sales()[0], 5001n)).toThrow();
    expect(() => refund(sales()[0], 1n, 0n, 1000n)).toThrow();
    expect(() =>
      calculateRefund({
        sale: sales()[0],
        refundRef: "f",
        occurredAt: later,
        currency: "EUR",
        refundMinor: 1n,
        alreadyRefundedMinor: 0n,
        alreadyReversedMinor: 0n,
      }),
    ).toThrow();
  });
  it("uses exact arithmetic beyond Number.MAX_SAFE_INTEGER", () =>
    expect(commission(900719925474099300n, 2500)).toBe(225179981368524825n));
  it("has stable collision-safe keys independent of webhook delivery ID", () => {
    expect(sales()[0].sourceKey).toBe(sales()[0].sourceKey);
    expect(sourceKey("sale", "a:b", "c")).not.toBe(
      sourceKey("sale", "a", "b:c"),
    );
    expect(sourceKey("refund", "o1", "l1")).not.toBe(
      sourceKey("sale", "o1", "l1"),
    );
  });
  it("rejects malformed rates, line amounts, duplicate lines and overlapping histories", () => {
    expect(percentageToBps("20.25")).toBe(2025);
    for (const rate of ["NaN", "-1", "100.01", "1.001", "1e2"])
      expect(() => percentageToBps(rate)).toThrow();
    expect(() => sales({ lines: [line, line] })).toThrow();
    expect(() =>
      sales({ lines: [{ ...line, discountMinor: 7000n }] }),
    ).toThrow();
    expect(() =>
      sales({ assignments: [...assignments, assignments[0]] }),
    ).toThrow();
    expect(() => sales({ rates: [] })).toThrow();
  });
  it("accepts zero percent and fully discounted merchandise", () => {
    expect(commission(100n, 0)).toBe(0n);
    expect(
      sales({ lines: [{ ...line, discountMinor: 6000n }] })[0].commissionMinor,
    ).toBe(0n);
  });
  it("conserves every cent across varied partial refund schedules", () => {
    for (let amount = 1n; amount <= 101n; amount++) {
      const sale = sales({
        lines: [{ ...line, grossMinor: amount, discountMinor: 0n }],
      })[0];
      let base = 0n;
      let reversed = 0n;
      while (base < amount) {
        const r = refund(sale, 1n, base, reversed);
        base++;
        reversed -= r.commissionMinor;
      }
      expect(reversed).toBe(sale.commissionMinor);
    }
  });
});
