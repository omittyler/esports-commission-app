import { describe, expect, it } from "vitest";
import {
  registrationProfile,
  requireApprovedAffiliate,
} from "../../app/services/affiliates/profile";
import { amountToMinor, formatMinor } from "../../app/services/money";
import {
  calculateSales,
  calculateRefund,
} from "../../app/services/commissions/domain";
import {
  normalizeOrder,
  webhookResource,
} from "../../app/services/shopify/orders";
const date = new Date("2098-01-01T00:00:00Z");
const profile = (type: string) => {
  const f = new FormData();
  Object.entries({
    type,
    firstName: "Alex",
    lastName: "Partner",
    email: "ALEX@example.com",
    paypalEmail: "pay@example.com",
    organizationName: "Team Test",
    organizationRole: "Manager",
    creatorName: "Alex Creates",
  }).forEach(([k, v]) => f.set(k, v));
  return f;
};
describe("registration and authorization", () => {
  it("requires organization-specific fields", () => {
    expect(registrationProfile(profile("organization"))).toMatchObject({
      type: "organization",
      displayName: "Team Test",
      organizationRole: "Manager",
      email: "alex@example.com",
    });
    const f = profile("organization");
    f.delete("organizationRole");
    expect(() => registrationProfile(f)).toThrow();
  });
  it("uses creator fields and discards organization roles", () => {
    const f = profile("creator");
    f.delete("organizationName");
    expect(registrationProfile(f)).toMatchObject({
      type: "creator",
      displayName: "Alex Creates",
      organizationRole: null,
    });
    f.delete("creatorName");
    expect(() => registrationProfile(f)).toThrow();
  });
  it("validates payout emails and applicant type", () => {
    const f = profile("creator");
    f.set("paypalEmail", "invalid");
    expect(() => registrationProfile(f)).toThrow();
    expect(() => registrationProfile(profile("admin"))).toThrow();
  });
  it("blocks pending, suspended, unverified and mismatched subjects", () => {
    const a = {
      status: "approved",
      organizationId: "alpha",
      authSubject: "owner",
      verifiedAt: date,
    };
    expect(requireApprovedAffiliate(a, "owner")).toBe("alpha");
    for (const change of [
      { status: "pending" },
      { status: "suspended" },
      { verifiedAt: null },
      { organizationId: null },
      { authSubject: "someone-else" },
    ])
      expect(() =>
        requireApprovedAffiliate({ ...a, ...change }, "owner"),
      ).toThrow();
  });
});
describe("program accounting", () => {
  const sale = (
    base = 10000n,
    quantity = 2,
    kind: "fixed_item" | "percentage" = "fixed_item",
  ) =>
    calculateSales({
      orderRef: "order",
      occurredAt: date,
      currency: "USD",
      lines: [
        {
          lineGid: "line",
          productGid: "p",
          variantGid: null,
          quantity,
          grossMinor: base,
          discountMinor: 0n,
        },
      ],
      assignments: [
        {
          id: "a",
          organizationId: "alpha",
          productGid: "p",
          variantGid: null,
          effectiveFrom: date,
          effectiveTo: null,
          programVersionId: "v",
        },
      ],
      rates: [],
      programs: [
        {
          id: "v",
          kind,
          rateBps: kind === "percentage" ? 2000 : 0,
          fixedMinor: kind === "fixed_item" ? 500n : null,
          currency: "USD",
        },
      ],
    })[0];
  it("pays dollars per item, not per order", () => {
    expect(sale().commissionMinor).toBe(1000n);
    expect(sale().rateId).toBeNull();
    expect(sale().programVersionId).toBe("v");
  });
  it("caps fixed commissions at discounted revenue and excludes free items", () => {
    expect(sale(300n).commissionMinor).toBe(300n);
    expect(sale(0n).commissionMinor).toBe(0n);
  });
  it("applies percentage program snapshots", () =>
    expect(sale(10000n, 2, "percentage").commissionMinor).toBe(2000n));
  it("reverses fixed commissions proportionally and conserves full refund", () => {
    const original = sale();
    const partial = calculateRefund({
      sale: original,
      refundRef: "r",
      occurredAt: date,
      currency: "USD",
      refundMinor: 5000n,
      alreadyRefundedMinor: 0n,
      alreadyReversedMinor: 0n,
    });
    expect(partial.commissionMinor).toBe(-500n);
    expect(partial.fixedMinor).toBe(500n);
    const rest = calculateRefund({
      sale: original,
      refundRef: "r2",
      occurredAt: date,
      currency: "USD",
      refundMinor: 5000n,
      alreadyRefundedMinor: 5000n,
      alreadyReversedMinor: 500n,
    });
    expect(rest.commissionMinor + partial.commissionMinor).toBe(
      -original.commissionMinor,
    );
  });
  it("parses and formats large amounts exactly with currency exponents", () => {
    expect(amountToMinor("9007199254.99", "USD")).toBe(900719925499n);
    expect(amountToMinor("5", "JPY")).toBe(5n);
    expect(formatMinor(-123n, "USD")).toBe("USD -1.23");
    expect(() => amountToMinor("1.001", "USD")).toThrow();
  });
});
describe("Shopify normalization", () => {
  it("uses allocated discounts and never includes shipping/tax or customer fields", () => {
    const result = normalizeOrder(
      {
        id: "gid://shopify/Order/1",
        name: "#1",
        createdAt: date.toISOString(),
        lines: [
          {
            id: "l",
            name: "Jersey",
            sku: null,
            quantity: 1,
            currentQuantity: 1,
            isGiftCard: false,
            product: { id: "p" },
            variant: null,
            originalTotalSet: {
              shopMoney: { amount: "60.00", currencyCode: "USD" },
            },
            discountAllocations: [
              {
                allocatedAmountSet: {
                  shopMoney: { amount: "10.00", currencyCode: "USD" },
                },
              },
            ],
          },
        ],
      },
      "USD",
    );
    expect(result.lines[0].grossMinor - result.lines[0].discountMinor).toBe(
      5000n,
    );
    expect(result).not.toHaveProperty("customer");
  });
  it("keeps exact refund GIDs when webhook JSON order numbers are unsafe", () => {
    expect(
      webhookResource("REFUNDS_CREATE", {
        order_id: 9007199254740994,
        admin_graphql_api_id: "gid://shopify/Refund/123",
      }),
    ).toBe("gid://shopify/Refund/123");
    expect(() =>
      webhookResource("REFUNDS_CREATE", { order_id: 9007199254740994 }),
    ).toThrow();
  });
});
