import { afterAll, beforeAll, describe, expect, it } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

let postgres: EmbeddedPostgres | undefined;
let db: PrismaClient;
let recordOrder: typeof import("../../app/services/commissions/ledger.server").recordOrder;
let recordRefund: typeof import("../../app/services/commissions/ledger.server").recordRefund;
let orgId: string;
let assignmentId: string;
let rateId: string;
const saleTime = new Date("2026-01-02T00:00:00Z");
const orderInput = {
  orderRef: "gid://shopify/Order/101",
  displayName: "#101",
  occurredAt: saleTime,
  currency: "USD",
  lines: [
    {
      lineGid: "gid://shopify/LineItem/101",
      productGid: "gid://shopify/Product/101",
      variantGid: null,
      quantity: 2,
      grossMinor: 10000n,
      discountMinor: 0n,
      title: "Alpha jersey",
    },
  ],
};

beforeAll(async () => {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  if (process.env.TEST_DATABASE_URL) {
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("schema", schema);
    process.env.DATABASE_URL = url.toString();
  } else {
    postgres = new EmbeddedPostgres({
      databaseDir: join(process.cwd(), ".postgres-test", schema),
      user: "commission",
      password: "test-only",
      port: 55439,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase("commission_test");
    process.env.DATABASE_URL = `postgresql://commission:test-only@localhost:55439/commission_test?schema=${schema}`;
  }
  process.env.SHOP_CURRENCY = "USD";
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: process.env, stdio: "pipe" },
  );
  db = (await import("../../app/db.server")).default;
  ({ recordOrder, recordRefund } =
    await import("../../app/services/commissions/ledger.server"));
  const org = await db.organization.create({
    data: {
      name: "Test Alpha",
      slug: schema,
      rates: {
        create: {
          rateBps: 2500,
          effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        },
      },
      assignments: {
        create: {
          productGid: orderInput.lines[0].productGid,
          displayTitle: "Alpha jersey",
          effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        },
      },
    },
    include: { rates: true, assignments: true },
  });
  orgId = org.id;
  rateId = org.rates[0].id;
  assignmentId = org.assignments[0].id;
});
afterAll(async () => {
  if (db) await db.$disconnect();
  if (postgres) await postgres.stop();
});

describe("PostgreSQL financial invariants", () => {
  it("records concurrent duplicate orders exactly once and rejects changed input", async () => {
    const [a, b] = await Promise.all([
      recordOrder(orderInput),
      recordOrder(orderInput),
    ]);
    expect(a[0].id).toBe(b[0].id);
    expect(await db.commissionTransaction.count()).toBe(1);
    await expect(
      recordOrder({
        ...orderInput,
        lines: [{ ...orderInput.lines[0], grossMinor: 9999n }],
      }),
    ).rejects.toThrow("reconciliation");
  });
  it("posts concurrent duplicate refunds once and conserves full reversal", async () => {
    const sale = (await recordOrder(orderInput))[0];
    const input = {
      saleId: sale.id,
      refundRef: "gid://shopify/Refund/101",
      occurredAt: new Date("2026-02-01T00:00:00Z"),
      currency: "USD",
      refundMinor: 5000n,
    };
    const [a, b] = await Promise.all([
      recordRefund(input),
      recordRefund(input),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.commissionMinor).toBe(-1250n);
    await expect(
      recordRefund({ ...input, refundMinor: 4999n }),
    ).rejects.toThrow("replay differs");
    await recordRefund({ ...input, refundRef: "gid://shopify/Refund/102" });
    expect(
      (
        await db.commissionTransaction.aggregate({
          _sum: { commissionMinor: true },
        })
      )._sum.commissionMinor,
    ).toBe(0n);
    await expect(
      recordRefund({
        ...input,
        refundRef: "gid://shopify/Refund/103",
        refundMinor: 1n,
      }),
    ).rejects.toThrow();
  });
  it("blocks updates, deletes, and truncation of posted ledger entries", async () => {
    const sale = (await recordOrder(orderInput))[0];
    await expect(
      db.commissionTransaction.update({
        where: { id: sale.id },
        data: { commissionMinor: 1n },
      }),
    ).rejects.toThrow();
    await expect(
      db.commissionTransaction.delete({ where: { id: sale.id } }),
    ).rejects.toThrow();
    await expect(
      db.$executeRawUnsafe('TRUNCATE "CommissionTransaction" CASCADE'),
    ).rejects.toThrow();
  });
  it("rejects overlapping rates and product assignments", async () => {
    await expect(
      db.commissionRate.create({
        data: { organizationId: orgId, rateBps: 2000, effectiveFrom: saleTime },
      }),
    ).rejects.toThrow();
    await expect(
      db.productAssignment.create({
        data: {
          organizationId: orgId,
          productGid: orderInput.lines[0].productGid,
          displayTitle: "Conflict",
          effectiveFrom: saleTime,
        },
      }),
    ).rejects.toThrow();
  });
  it("blocks historical rate and attribution edits", async () => {
    await expect(
      db.commissionRate.update({
        where: { id: rateId },
        data: { rateBps: 3000 },
      }),
    ).rejects.toThrow();
    await expect(
      db.productAssignment.update({
        where: { id: assignmentId },
        data: { productGid: "gid://shopify/Product/999" },
      }),
    ).rejects.toThrow();
  });
  it("enforces original refund snapshots and amounts even outside the service", async () => {
    const sale = (await recordOrder(orderInput))[0];
    const data = {
      organizationId: sale.organizationId,
      orderId: sale.orderId,
      orderLineId: sale.orderLineId,
      rateId: sale.rateId,
      assignmentId: sale.assignmentId,
      rateBps: sale.rateBps,
      currency: sale.currency,
    };
    await expect(
      db.commissionTransaction.create({
        data: {
          ...data,
          type: "refund",
          sourceKey: JSON.stringify([
            "refund",
            "bad",
            orderInput.lines[0].lineGid,
          ]),
          sourceRef: "bad",
          reversalOfId: sale.id,
          baseMinor: -1n,
          commissionMinor: -100n,
          occurredAt: new Date("2026-03-01T00:00:00Z"),
        },
      }),
    ).rejects.toThrow();
  });
  it("rejects over-refunding with distinct concurrent event IDs", async () => {
    const input = {
      ...orderInput,
      orderRef: "gid://shopify/Order/102",
      lines: [
        { ...orderInput.lines[0], lineGid: "gid://shopify/LineItem/102" },
      ],
    };
    const sale = (await recordOrder(input))[0];
    const results = await Promise.allSettled(
      ["201", "202"].map((ref) =>
        recordRefund({
          saleId: sale.id,
          refundRef: `gid://shopify/Refund/${ref}`,
          occurredAt: new Date("2026-02-01T00:00:00Z"),
          currency: "USD",
          refundMinor: 7000n,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(
      (
        await db.commissionTransaction.aggregate({
          where: { reversalOfId: sale.id },
          _sum: { baseMinor: true },
        })
      )._sum.baseMinor,
    ).toBe(-7000n);
  });
  it("seeds Team Alpha and Team Bravo idempotently", async () => {
    const seed = () =>
      execFileSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
        env: process.env,
        stdio: "pipe",
      });
    seed();
    seed();
    const seeded = await db.organization.findMany({
      where: { slug: { in: ["team-alpha", "team-bravo"] } },
      include: { rates: true },
      orderBy: { slug: "asc" },
    });
    expect(
      seeded.map((o) => [o.name, o.rates.length, o.rates[0].rateBps]),
    ).toEqual([
      ["Team Alpha", 1, 2000],
      ["Team Bravo", 1, 1500],
    ]);
  });
  it("schedules future rates without changing snapshots and retires assignments", async () => {
    const { updateOrganization, retireAssignment } =
      await import("../../app/services/admin.server");
    const form = new FormData();
    form.set("intent", "rate");
    form.set("percentage", "30");
    form.set("effectiveFrom", "2099-01-01T00:00:00Z");
    await updateOrganization(orgId, form, "test-admin");
    expect((await recordOrder(orderInput))[0].rateBps).toBe(2500);
    await retireAssignment(assignmentId, "test-admin");
    expect(
      (
        await db.productAssignment.findUniqueOrThrow({
          where: { id: assignmentId },
        })
      ).effectiveTo,
    ).not.toBeNull();
  });
});
