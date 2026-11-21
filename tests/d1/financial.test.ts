import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sqliteBinding } from "./sqlite-binding";
import db, { withDatabase } from "../../cloudflare/database.server";
import {
  recordOrder,
  recordRefund,
  recordRefunds,
} from "../../app/services/commissions/ledger.server";
import {
  recordPayment,
  voidPayment,
} from "../../app/services/payments/payments.server";
import {
  assignCollectionSnapshot,
  updateOrganization,
  retireAssignment,
} from "../../app/services/admin.server";
let test: ReturnType<typeof sqliteBinding>;
beforeEach(() => {
  test = sqliteBinding();
  process.env.SHOP_CURRENCY = "USD";
});
afterEach(() => test.close());
const run = <T>(work: () => T) => withDatabase(test.binding, work);
async function fixture(rateBps = 2500) {
  const org = await db.organization.create({
    data: {
      name: "D1 Team",
      slug: randomUUID(),
      rates: { create: { rateBps, effectiveFrom: new Date("2026-01-01") } },
    },
  });
  const assignment = await db.productAssignment.create({
    data: {
      organizationId: org.id,
      productGid: "gid://shopify/Product/101",
      variantGid: null,
      displayTitle: "Jersey",
      effectiveFrom: new Date("2026-01-01"),
    },
  });
  await db.affiliateAccount.create({
    data: {
      type: "creator",
      firstName: "D1",
      lastName: "Test",
      email: `${randomUUID()}@example.test`,
      displayName: "D1 Creator",
      paypalEmail: "pay@example.test",
      authSubject: randomUUID(),
      verifiedAt: new Date(),
      status: "approved",
      organizationId: org.id,
    },
  });
  return { org, assignment };
}
function order(n = 101, gross = 10000n) {
  return {
    orderRef: `gid://shopify/Order/${n}`,
    displayName: `#${n}`,
    occurredAt: new Date("2026-01-02"),
    currency: "USD",
    lines: [
      {
        lineGid: `gid://shopify/LineItem/${n}`,
        productGid: "gid://shopify/Product/101",
        variantGid: null,
        quantity: 2,
        grossMinor: gross,
        discountMinor: 0n,
        title: "Jersey",
      },
    ],
  };
}
function payment(amount: string, reference = randomUUID()) {
  const form = new FormData();
  Object.entries({
    currency: "USD",
    amount,
    paidAt: "2026-01-03",
    method: "paypal",
    reference,
    idempotencyKey: randomUUID(),
    confirmed: "yes",
  }).forEach(([k, v]) => form.set(k, v));
  return form;
}
describe("D1 financial transactions", () => {
  it("rejects unsupported array writes before executing any mutation", () =>
    run(async () => {
      await expect(
        db.$transaction([
          db.organization.create({
            data: { name: "Unsupported", slug: "unsupported" },
          }),
        ]),
      ).rejects.toThrow("Only lazy read");
      expect(await db.organization.count()).toBe(0);
    }));
  it("posts orders atomically, deduplicates concurrent replays, and rejects changed inputs", () =>
    run(async () => {
      await fixture();
      const result = await Promise.all([
        recordOrder(order()),
        recordOrder(order()),
      ]);
      expect(result[0][0].commissionMinor).toBe(2500n);
      expect(result[0][0].id).toBe(result[1][0].id);
      expect(await db.order.count()).toBe(1);
      await expect(recordOrder(order(101, 9999n))).rejects.toThrow(
        "replay differs",
      );
      await expect(
        recordOrder({
          ...order(102),
          lines: [order(102).lines[0], order(102).lines[0]],
        }),
      ).rejects.toThrow();
      expect(await db.order.count()).toBe(1);
    }));
  it("conserves pennies through multiple refunds in one batch and enforces caps", () =>
    run(async () => {
      await fixture(3333);
      const [sale] = await recordOrder(order(101, 101n));
      const input = {
        saleId: sale.id,
        refundRef: "refund-1",
        refundMinor: 50n,
        occurredAt: new Date("2026-01-04"),
        currency: "USD",
      };
      const refunds = await recordRefunds([
        input,
        { ...input, refundRef: "refund-2", refundMinor: 51n },
      ]);
      expect(refunds.reduce((n, r) => n + r.commissionMinor, 0n)).toBe(
        -sale.commissionMinor,
      );
      expect((await recordRefund(input)).id).toBe(refunds[0].id);
      await expect(
        recordRefund({ ...input, refundRef: "excess", refundMinor: 1n }),
      ).rejects.toThrow();
      expect(await db.commissionTransaction.count()).toBe(3);
    }));
  it("rejects unsafe monetary integers and validates exact large refund ratios in SQL", () =>
    run(async () => {
      await fixture(9999);
      const base = BigInt(Number.MAX_SAFE_INTEGER);
      const [sale] = await recordOrder(order(101, base));
      expect(sale.commissionMinor).toBe((base * 9999n + 5000n) / 10000n);
      const r = await recordRefund({
        saleId: sale.id,
        refundRef: "large",
        refundMinor: base - 1n,
        occurredAt: new Date("2026-01-03"),
        currency: "USD",
      });
      expect(r.commissionMinor).toBe(
        -((sale.commissionMinor * (base - 1n) + base / 2n) / base),
      );
      await expect(recordOrder(order(102, base + 1n))).rejects.toThrow(
        "exact integer range",
      );
      expect(await db.order.count()).toBe(1);
    }));
  it("preserves paid refunds, applies credits to later earnings, and appends payment corrections", () =>
    run(async () => {
      const { org } = await fixture();
      const [sale] = await recordOrder(order());
      const form = payment("25.00");
      const p = await recordPayment(org.id, form, "admin");
      expect((await recordPayment(org.id, form, "admin")).id).toBe(p.id);
      await recordRefund({
        saleId: sale.id,
        refundRef: "return",
        refundMinor: 10000n,
        occurredAt: new Date("2026-01-04"),
        currency: "USD",
      });
      await expect(
        recordPayment(org.id, payment("0.01"), "admin"),
      ).rejects.toThrow();
      await recordOrder(order(102, 20000n));
      const next = await recordPayment(org.id, payment("25.00"), "admin");
      const allocations = await db.paymentAllocation.findMany({
        where: { paymentId: next.id },
      });
      expect(allocations.map((a) => a.amountMinor).sort()).toEqual([
        -2500n,
        5000n,
      ]);
      const correction = new FormData();
      correction.set("paymentId", next.id);
      correction.set("reason", "Duplicate manual record");
      correction.set("confirmed", "yes");
      await voidPayment(org.id, correction, "admin");
      await voidPayment(org.id, correction, "admin");
      expect(await db.paymentVoid.count()).toBe(1);
      expect(await db.commissionPayment.count()).toBe(2);
      expect(await db.auditEvent.count()).toBe(3);
    }));
  it("serializes competing payments and rejects incomplete or edited payment records", () =>
    run(async () => {
      const { org } = await fixture();
      await recordOrder(order());
      const results = await Promise.allSettled([
        recordPayment(org.id, payment("20.00"), "admin"),
        recordPayment(org.id, payment("20.00"), "admin"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await db.commissionPayment.count()).toBe(1);
      const p = await db.commissionPayment.findFirstOrThrow();
      expect(() =>
        test.sqlite
          .prepare(
            'UPDATE "CommissionPaymentDraft" SET "amountMinor"=1 WHERE id=?',
          )
          .run(p.id),
      ).toThrow("Append-only");
      expect(() =>
        test.sqlite
          .prepare('INSERT INTO "PaymentSeal" VALUES (?)')
          .run("missing"),
      ).toThrow();
    }));
  it("protects historical rates and assignments and supports prospective retirement", () =>
    run(async () => {
      const { org, assignment } = await fixture();
      const [sale] = await recordOrder(order());
      const form = new FormData();
      form.set("intent", "rate");
      form.set("percentage", "10");
      form.set("effectiveFrom", "2098-01-01T00:00:00Z");
      await updateOrganization(org.id, form, "admin");
      await retireAssignment(assignment.id, "admin");
      expect(
        (
          await db.commissionTransaction.findUniqueOrThrow({
            where: { id: sale.id },
          })
        ).rateBps,
      ).toBe(2500);
      expect(() =>
        test.sqlite.exec('UPDATE "CommissionRate" SET "rateBps"=1'),
      ).toThrow("History");
      expect(() =>
        test.sqlite.exec('DELETE FROM "CommissionTransaction"'),
      ).toThrow("Append-only");
    }));
  it("assigns a collection atomically while preserving explicit assignments", () =>
    run(async () => {
      const { org } = await fixture();
      await db.affiliateAccount.update({
        where: { organizationId: org.id },
        data: { organizationId: null, status: "pending" },
      });
      const result = await assignCollectionSnapshot(
        {
          organizationId: org.id,
          collectionGid: "gid://shopify/Collection/1",
          collectionTitle: "Team collection",
          effectiveFrom: new Date("2098-01-01"),
          products: [
            { id: "gid://shopify/Product/101", title: "Explicit jersey" },
            { id: "gid://shopify/Product/102", title: "New jersey" },
          ],
        },
        "admin",
      );
      expect(result.assigned).toBe(1);
      expect(result.skipped).toHaveLength(1);
    }));
  it("keeps fixed-per-item program snapshots and zero-value item returns exact", () =>
    run(async () => {
      const { org } = await fixture();
      const program = await db.commissionProgram.create({
        data: { name: "Fixed jersey program" },
      });
      const version = await db.programVersion.create({
        data: {
          programId: program.id,
          label: "$5 per item",
          kind: "fixed_item",
          rateBps: 0,
          fixedMinor: 500n,
          currency: "USD",
        },
      });
      await db.productAssignment.create({
        data: {
          organizationId: org.id,
          productGid: "gid://shopify/Product/103",
          displayTitle: "Fixed jersey",
          programVersionId: version.id,
          effectiveFrom: new Date("2027-01-01"),
        },
      });
      const input = {
        ...order(103, 1500n),
        occurredAt: new Date("2098-01-02"),
        lines: [
          {
            ...order(103, 1500n).lines[0],
            productGid: "gid://shopify/Product/103",
            quantity: 4,
          },
        ],
      };
      const [sale] = await recordOrder(input);
      expect(sale.commissionMinor).toBe(1500n);
      await db.programVersion.create({
        data: {
          programId: program.id,
          label: "$10 per item",
          kind: "fixed_item",
          rateBps: 0,
          fixedMinor: 1000n,
          currency: "USD",
        },
      });
      const refund = await recordRefund({
        saleId: sale.id,
        refundRef: "fixed-refund",
        refundMinor: 500n,
        refundedQuantity: 1,
        occurredAt: new Date("2098-01-03"),
        currency: "USD",
      });
      expect(refund.commissionMinor).toBe(-500n);
      const quantityOnly = await recordRefund({
        saleId: sale.id,
        refundRef: "free-item-return",
        refundMinor: 0n,
        refundedQuantity: 1,
        occurredAt: new Date("2098-01-03"),
        currency: "USD",
      });
      expect(quantityOnly.commissionMinor).toBe(0n);
      expect(() =>
        test.sqlite.exec('UPDATE "ProgramVersion" SET "fixedMinor"=1'),
      ).toThrow("Append-only");
    }));
  it("handles large collection snapshots and many-line orders within a bounded query count", () =>
    run(async () => {
      const { org } = await fixture();
      await db.affiliateAccount.update({
        where: { organizationId: org.id },
        data: { organizationId: null, status: "pending" },
      });
      const before = test.queries();
      const products = Array.from({ length: 1000 }, (_, n) => ({
        id: `gid://shopify/Product/${101 + n}`,
        title: `Jersey ${n}`,
      }));
      const result = await assignCollectionSnapshot(
        {
          organizationId: org.id,
          collectionGid: "gid://shopify/Collection/100",
          collectionTitle: "Large collection",
          products,
          effectiveFrom: new Date("2098-01-01"),
        },
        "admin",
      );
      expect(result.assigned).toBe(999);
      expect(test.queries() - before).toBeLessThan(30);
      const start = test.queries();
      const lines = Array.from({ length: 100 }, (_, n) => ({
        ...order(5000 + n).lines[0],
        productGid: "gid://shopify/Product/101",
      }));
      expect(await recordOrder({ ...order(5000), lines })).toHaveLength(100);
      expect(test.queries() - start).toBeLessThan(20);
    }));
  it("sums reports in bigint even when the total exceeds one row's safe range", () =>
    run(async () => {
      const { org } = await fixture(10000);
      const base = BigInt(Number.MAX_SAFE_INTEGER);
      await recordOrder(order(101, base));
      await recordOrder(order(102, base));
      const [totals, groups] = await db.$transaction([
        db.commissionTransaction.aggregate({ _sum: { commissionMinor: true } }),
        db.commissionTransaction.groupBy({
          by: ["organizationId", "currency"],
          orderBy: { organizationId: "asc" },
          _sum: { commissionMinor: true },
        }),
      ]);
      expect(totals._sum.commissionMinor).toBe(base * 2n);
      expect(groups).toMatchObject([
        { organizationId: org.id, _sum: { commissionMinor: base * 2n } },
      ]);
    }));
  it("rejects forged calculations and overlapping assignments at the SQL boundary", () =>
    run(async () => {
      const { org, assignment } = await fixture();
      const [sale] = await recordOrder(order());
      const bad = {
        ...sale,
        id: randomUUID(),
        sourceKey: JSON.stringify([
          "refund",
          "forged",
          "gid://shopify/LineItem/101",
        ]),
        sourceRef: "forged",
        type: "refund" as const,
        reversalOfId: sale.id,
        baseMinor: -1000n,
        commissionMinor: -999n,
        occurredAt: new Date("2026-01-04"),
      };
      await expect(
        db.commissionTransaction.create({ data: bad }),
      ).rejects.toThrow();
      await expect(
        db.productAssignment.create({
          data: {
            organizationId: org.id,
            productGid: assignment.productGid,
            displayTitle: "Overlap",
            effectiveFrom: new Date("2026-01-02"),
          },
        }),
      ).rejects.toThrow();
      expect(await db.commissionTransaction.count()).toBe(1);
    }));
});
