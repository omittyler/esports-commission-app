import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
const providerGetUser = vi.hoisted(() => vi.fn());
const providerOtp = vi.hoisted(() => vi.fn());
const providerVerify = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: providerGetUser,
      signInWithOtp: providerOtp,
      verifyOtp: providerVerify,
    },
  }),
}));

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
  it("reconciles paginated paid orders and refunds idempotently, including free-item returns", async () => {
    const { reconcileOrder } =
      await import("../../app/services/shopify/ingestion.server");
    const fixture = (id: number, free: boolean) => {
      const order = {
        id: `gid://shopify/Order/${id}`,
        name: `#${id}`,
        createdAt: saleTime.toISOString(),
        displayFinancialStatus: "PARTIALLY_REFUNDED",
        taxesIncluded: false,
        edited: false,
        dutiesIncluded: false,
        lineItems: {
          nodes: [
            {
              id: `gid://shopify/LineItem/${id}`,
              name: "Alpha jersey",
              sku: null,
              quantity: 2,
              currentQuantity: free ? 0 : 1,
              isGiftCard: false,
              product: { id: orderInput.lines[0].productGid },
              variant: { id: "gid://shopify/ProductVariant/9100" },
              originalTotalSet: {
                shopMoney: {
                  amount: free ? "0.00" : "100.00",
                  currencyCode: "USD",
                },
              },
              discountAllocations: [],
            },
          ],
          pageInfo: { hasNextPage: true, endCursor: "page-2" },
        },
        refunds: [
          {
            id: `gid://shopify/Refund/${id}`,
            createdAt: "2026-01-03T00:00:00Z",
          },
        ],
      };
      const refund = {
        id: order.refunds[0].id,
        createdAt: order.refunds[0].createdAt,
        transactions: {
          pageInfo: { hasNextPage: false },
          nodes: free ? [] : [{ kind: "REFUND", status: "SUCCESS" }],
        },
        refundLineItems: {
          nodes: [
            {
              quantity: free ? 2 : 1,
              lineItem: { id: order.lineItems.nodes[0].id },
              subtotalSet: {
                shopMoney: {
                  amount: free ? "0.00" : "50.00",
                  currencyCode: "USD",
                },
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      };
      const graphql = vi.fn(
        async (
          query: string,
          options: { variables: { after?: string | null } },
        ) =>
          new Response(
            JSON.stringify({
              data: query.includes("CommissionRefund")
                ? { refund }
                : {
                    order: options.variables.after
                      ? {
                          ...order,
                          lineItems: {
                            nodes: [],
                            pageInfo: { hasNextPage: false, endCursor: null },
                          },
                        }
                      : order,
                  },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      );
      return { order, refund, graphql };
    };
    const paid = fixture(9101, false);
    await reconcileOrder(paid.graphql, paid.order.id);
    await reconcileOrder(paid.graphql, paid.order.id);
    const entries = await db.commissionTransaction.findMany({
      where: { order: { shopifyOrderGid: paid.order.id } },
    });
    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, e) => sum + e.commissionMinor, 0n)).toBe(1250n);
    expect(entries.find((e) => e.type === "refund")?.refundedQuantity).toBe(1);
    const free = fixture(9102, true);
    await reconcileOrder(free.graphql, free.order.id);
    await reconcileOrder(free.graphql, free.order.id);
    const freeEntries = await db.commissionTransaction.findMany({
      where: { order: { shopifyOrderGid: free.order.id } },
    });
    expect(freeEntries).toHaveLength(2);
    expect(freeEntries.find((e) => e.type === "refund")).toMatchObject({
      baseMinor: 0n,
      commissionMinor: 0n,
      refundedQuantity: 2,
    });
    const pending = fixture(9103, false);
    pending.refund.transactions.nodes[0].status = "PENDING";
    await expect(
      reconcileOrder(pending.graphql, pending.order.id),
    ).rejects.toThrow("payment");
    const edited = fixture(9104, false);
    edited.order.lineItems.nodes[0].currentQuantity = 0;
    await expect(
      reconcileOrder(edited.graphql, edited.order.id),
    ).rejects.toThrow("Edited");
    const tax = fixture(9105, false);
    tax.order.taxesIncluded = true;
    await expect(reconcileOrder(tax.graphql, tax.order.id)).rejects.toThrow(
      "Tax-inclusive",
    );
    expect(
      await db.order.count({
        where: {
          shopifyOrderGid: {
            in: [pending.order.id, edited.order.id, tax.order.id],
          },
        },
      }),
    ).toBe(0);
  });

  it("requires a provider-verified email code before binding an applicant and denies cross-origin requests", async () => {
    const { action: register } =
      await import("../../app/routes/portal.register");
    const { action: verify } = await import("../../app/routes/portal.verify");
    const { sessionStore, requirePartner } =
      await import("../../app/services/affiliates/auth.server");
    process.env.SUPABASE_URL = "https://auth.example.test";
    process.env.SUPABASE_PUBLISHABLE_KEY = "test-public-key";
    process.env.PORTAL_SESSION_SECRET =
      "test-only-signing-key-with-more-than-thirty-two-characters";
    process.env.PORTAL_URL = "https://portal.example.test";
    const form = new FormData();
    Object.entries({
      type: "organization",
      firstName: "Terry",
      lastName: "Team",
      email: "otp@example.test",
      organizationName: "OTP Team",
      organizationRole: "Owner",
      paypalEmail: "pay@example.test",
    }).forEach(([k, v]) => form.set(k, v));
    providerOtp.mockResolvedValue({ error: null });
    const registration = await register({
      request: new Request("https://portal.example.test/portal/register", {
        method: "POST",
        headers: { Origin: "https://portal.example.test" },
        body: form,
      }),
      params: {},
      context: {},
      url: new URL("https://portal.example.test/portal/register"),
      pattern: "/portal/register",
    });
    expect(registration).toBeInstanceOf(Response);
    const challenge = (registration as Response).headers.get("Set-Cookie")!;
    const verifiedForm = new FormData();
    verifiedForm.set("code", "123456");
    verifiedForm.set("email", "attacker@example.test");
    const verifyRequest = () =>
      new Request("https://portal.example.test/portal/verify", {
        method: "POST",
        headers: {
          Origin: "https://portal.example.test",
          Cookie: challenge.split(";")[0],
        },
        body: verifiedForm,
      });
    const subject = randomUUID();
    providerVerify.mockResolvedValue({
      error: null,
      data: { session: { access_token: "verified-test-token" } },
    });
    providerGetUser.mockResolvedValue({
      error: null,
      data: {
        user: {
          id: subject,
          email: "attacker@example.test",
          email_confirmed_at: new Date().toISOString(),
        },
      },
    });
    await verify({
      request: verifyRequest(),
      params: {},
      context: {},
      url: new URL("https://portal.example.test/portal/verify"),
      pattern: "/portal/verify",
    });
    expect(
      await db.affiliateAccount.findUnique({
        where: { email: "otp@example.test" },
      }),
    ).toBeNull();
    providerGetUser.mockResolvedValue({
      error: null,
      data: {
        user: {
          id: subject,
          email: "otp@example.test",
          email_confirmed_at: new Date().toISOString(),
        },
      },
    });
    const response = await verify({
      request: verifyRequest(),
      params: {},
      context: {},
      url: new URL("https://portal.example.test/portal/verify"),
      pattern: "/portal/verify",
    });
    expect(response).toBeInstanceOf(Response);
    const signedCookie = (response as Response).headers.get("Set-Cookie")!;
    expect(
      (await sessionStore().getSession(signedCookie.split(";")[0])).get(
        "accessToken",
      ),
    ).toBe("verified-test-token");
    await expect(
      requirePartner(
        new Request("https://portal.example.test/portal/dashboard", {
          headers: { Cookie: signedCookie.split(";")[0] },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(providerVerify).toHaveBeenLastCalledWith({
      email: "otp@example.test",
      token: "123456",
      type: "email",
    });
    await expect(
      register({
        request: new Request("https://portal.example.test/portal/register", {
          method: "POST",
          headers: { Origin: "https://attacker.example.test" },
          body: form,
        }),
        params: {},
        context: {},
        url: new URL("https://portal.example.test/portal/register"),
        pattern: "/portal/register",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("materializes collection members without overwriting explicit product or variant assignments", async () => {
    const { assignCollectionSnapshot } =
      await import("../../app/services/admin.server");
    const productIds = [6001, 6002, 6003].map(
      (id) => `gid://shopify/Product/${id}`,
    );
    const protectedAssignment = await db.productAssignment.create({
      data: {
        organizationId: orgId,
        productGid: productIds[0],
        displayTitle: "Explicit product",
        effectiveFrom: saleTime,
      },
    });
    await db.productAssignment.create({
      data: {
        organizationId: orgId,
        productGid: productIds[1],
        variantGid: "gid://shopify/ProductVariant/6002",
        displayTitle: "Future variant",
        effectiveFrom: new Date("2099-01-01T00:00:00Z"),
      },
    });
    const input = {
      organizationId: orgId,
      collectionGid: "gid://shopify/Collection/6000",
      collectionTitle: "Current collection",
      products: productIds.map((id, i) => ({ id, title: `Product ${i}` })),
      effectiveFrom: new Date("2098-01-01T00:00:00Z"),
    };
    const result = await assignCollectionSnapshot(input, "test-admin");
    expect(result.assigned).toBe(1);
    expect(result.skipped.map((p) => p.id)).toEqual(productIds.slice(0, 2));
    expect(
      (
        await db.productAssignment.findUniqueOrThrow({
          where: { id: protectedAssignment.id },
        })
      ).effectiveTo,
    ).toBeNull();
    const repeated = await assignCollectionSnapshot(input, "test-admin");
    expect(repeated.assigned).toBe(0);
    expect(
      await db.productAssignment.count({
        where: { productGid: productIds[2] },
      }),
    ).toBe(1);
    const audit = await db.auditEvent.findFirstOrThrow({
      where: { action: "assignment.collection_snapshot", entityId: orgId },
    });
    expect(audit.metadata).toMatchObject({
      collectionGid: input.collectionGid,
      products: [input.products[2]],
    });
    const { affiliateReport } =
      await import("../../app/services/affiliates/reporting.server");
    const report = await affiliateReport(orgId);
    expect(
      report.assignments.filter((a) => a.collectionGid === input.collectionGid),
    ).toHaveLength(1);
    const other = await db.organization.create({
      data: {
        name: "Collection link isolation",
        slug: `collection-links-${randomUUID()}`,
      },
    });
    expect(
      (await affiliateReport(other.id)).assignments.some(
        (a) => a.collectionGid === input.collectionGid,
      ),
    ).toBe(false);
  });
  it("handles concurrent collection snapshots without duplicate assignments", async () => {
    const { assignCollectionSnapshot } =
      await import("../../app/services/admin.server");
    const input = {
      organizationId: orgId,
      collectionGid: "gid://shopify/Collection/7000",
      collectionTitle: "Concurrent",
      products: [7001, 7002].map((id) => ({
        id: `gid://shopify/Product/${id}`,
        title: `Product ${id}`,
      })),
      effectiveFrom: new Date("2098-01-01T00:00:00Z"),
    };
    const results = await Promise.all([
      assignCollectionSnapshot(input, "test-admin"),
      assignCollectionSnapshot(input, "test-admin"),
    ]);
    expect(results.reduce((sum, r) => sum + r.assigned, 0)).toBe(2);
    expect(
      await db.productAssignment.count({
        where: { productGid: { in: input.products.map((p) => p.id) } },
      }),
    ).toBe(2);
  });
  it("rejects invalid collection batches without writing any products", async () => {
    const { assignCollectionSnapshot } =
      await import("../../app/services/admin.server");
    const input = {
      organizationId: orgId,
      collectionGid: "gid://shopify/Collection/8000",
      collectionTitle: "Invalid",
      products: [
        { id: "gid://shopify/Product/8001", title: "Valid" },
        { id: "bad", title: "Invalid" },
      ],
      effectiveFrom: new Date("2098-01-01T00:00:00Z"),
    };
    await expect(
      assignCollectionSnapshot(input, "test-admin"),
    ).rejects.toThrow();
    expect(
      await db.productAssignment.count({
        where: { productGid: "gid://shopify/Product/8001" },
      }),
    ).toBe(0);
  });
  it("records concurrent duplicate orders exactly once and rejects changed input", async () => {
    const [a, b] = await Promise.all([
      recordOrder(orderInput),
      recordOrder(orderInput),
    ]);
    expect(a[0].id).toBe(b[0].id);
    expect(
      await db.commissionTransaction.count({
        where: { sourceRef: orderInput.orderRef },
      }),
    ).toBe(1);
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
          where: { order: { shopifyOrderGid: orderInput.orderRef } },
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
  it("registers both affiliate types and requires verification before approval", async () => {
    const { reviewAffiliate, registerVerifiedApplicant } =
      await import("../../app/services/affiliates/admin.server");
    const form = new FormData();
    Object.entries({
      type: "creator",
      firstName: "Alex",
      lastName: "Creator",
      email: "creator@example.test",
      creatorName: "Creator Test",
      paypalEmail: "paypal@example.test",
    }).forEach(([k, v]) => form.set(k, v));
    const { registrationProfile } =
      await import("../../app/services/affiliates/profile");
    const account = await db.affiliateAccount.create({
      data: registrationProfile(form),
    });
    await expect(
      reviewAffiliate(account.id, "approved", "admin"),
    ).rejects.toThrow("verify");
    const subject = randomUUID();
    await db.affiliateAccount.update({
      where: { id: account.id },
      data: { paypalEmail: "unverified-attacker@example.test" },
    });
    const [confirmed, concurrent] = await Promise.all([
      registerVerifiedApplicant(registrationProfile(form), subject),
      registerVerifiedApplicant(registrationProfile(form), subject),
    ]);
    expect(concurrent.id).toBe(confirmed.id);
    expect(confirmed.paypalEmail).toBe("paypal@example.test");
    const approved = await reviewAffiliate(account.id, "approved", "admin");
    expect(approved.organizationId).not.toBeNull();
    expect(
      (
        await db.organization.findUniqueOrThrow({
          where: { id: approved.organizationId! },
        })
      ).type,
    ).toBe("creator");
    form.set("paypalEmail", "attacker@example.test");
    const repeated = await registerVerifiedApplicant(
      registrationProfile(form),
      subject,
    );
    expect(repeated.paypalEmail).toBe("paypal@example.test");
    await reviewAffiliate(account.id, "approved", "admin");
    expect(
      await db.organization.count({ where: { id: approved.organizationId! } }),
    ).toBe(1);
  });
  it("snapshots fixed program commissions, reverses refunds, and prevents rule edits", async () => {
    const { saveProgram } =
      await import("../../app/services/affiliates/admin.server");
    const form = new FormData();
    Object.entries({
      name: "Fixed program",
      kind: "fixed_item",
      amount: "5.00",
    }).forEach(([k, v]) => form.set(k, v));
    const version = await saveProgram(form, "admin");
    await db.productAssignment.create({
      data: {
        organizationId: orgId,
        productGid: "gid://shopify/Product/9001",
        displayTitle: "Fixed product",
        effectiveFrom: new Date("2098-01-01T00:00:00Z"),
        programVersionId: version.id,
      },
    });
    const sale = (
      await recordOrder({
        ...orderInput,
        orderRef: "gid://shopify/Order/9001",
        occurredAt: new Date("2098-01-01T00:00:00Z"),
        lines: [
          {
            ...orderInput.lines[0],
            lineGid: "gid://shopify/LineItem/9001",
            productGid: "gid://shopify/Product/9001",
            grossMinor: 2000n,
          },
        ],
      })
    )[0];
    expect(sale.commissionMinor).toBe(1000n);
    expect(sale.fixedMinor).toBe(500n);
    expect(sale.rateId).toBeNull();
    const refund = await recordRefund({
      saleId: sale.id,
      refundRef: "gid://shopify/Refund/9001",
      occurredAt: new Date("2098-02-01T00:00:00Z"),
      currency: "USD",
      refundMinor: 1000n,
      refundedQuantity: 1,
    });
    expect(refund.commissionMinor).toBe(-500n);
    await expect(
      db.programVersion.update({
        where: { id: version.id },
        data: { fixedMinor: 999n },
      }),
    ).rejects.toThrow();
    form.set("programId", version.programId);
    form.set("amount", "7.00");
    await saveProgram(form, "admin");
    expect(
      (
        await db.commissionTransaction.findUniqueOrThrow({
          where: { id: sale.id },
        })
      ).fixedMinor,
    ).toBe(500n);
    const { id: _id, createdAt: _createdAt, ...entry } = sale;
    void _id;
    void _createdAt;
    await expect(
      db.commissionTransaction.create({
        data: {
          ...entry,
          sourceKey: JSON.stringify([
            "sale",
            "bad-fixed",
            "gid://shopify/LineItem/9001",
          ]),
          sourceRef: "bad-fixed",
          commissionMinor: 2001n,
        },
      }),
    ).rejects.toThrow();
  });
  it("scopes partner reports to provider-verified approved membership and rejects forged sessions", async () => {
    const { requirePartner, sessionStore } =
      await import("../../app/services/affiliates/auth.server");
    const { affiliateReport } =
      await import("../../app/services/affiliates/reporting.server");
    process.env.SUPABASE_URL = "https://auth.example.test";
    process.env.SUPABASE_PUBLISHABLE_KEY = "test-key";
    process.env.PORTAL_SESSION_SECRET =
      "a-test-secret-with-at-least-32-characters";
    const account = await db.affiliateAccount.findUniqueOrThrow({
      where: { email: "creator@example.test" },
    });
    providerGetUser.mockResolvedValue({
      data: {
        user: {
          id: account.authSubject,
          email: account.email,
          email_confirmed_at: new Date().toISOString(),
        },
      },
      error: null,
    });
    const store = sessionStore();
    const session = await store.getSession();
    session.set("accessToken", "verified-test-token");
    session.set("organizationId", orgId);
    const cookie = await store.commitSession(session);
    const context = await requirePartner(
      new Request(
        `https://portal.example.test/portal/dashboard?affiliateId=${orgId}`,
        { headers: { Cookie: cookie } },
      ),
    );
    expect(context.organizationId).toBe(account.organizationId);
    expect((await affiliateReport(context.organizationId)).orders).toEqual([]);
    const version = await db.programVersion.findFirstOrThrow({
      where: { kind: "fixed_item", fixedMinor: 500n },
    });
    await db.productAssignment.create({
      data: {
        organizationId: context.organizationId,
        productGid: "gid://shopify/Product/9201",
        displayTitle: "Creator jersey",
        effectiveFrom: new Date("2098-01-01T00:00:00Z"),
        programVersionId: version.id,
      },
    });
    await recordOrder({
      ...orderInput,
      orderRef: "gid://shopify/Order/9201",
      displayName: "#9201",
      occurredAt: new Date("2098-01-02T00:00:00Z"),
      lines: [
        {
          ...orderInput.lines[0],
          lineGid: "gid://shopify/LineItem/9201",
          productGid: "gid://shopify/Product/9201",
          title: "Creator jersey",
          grossMinor: 2000n,
        },
        {
          ...orderInput.lines[0],
          lineGid: "gid://shopify/LineItem/9202",
          productGid: "gid://shopify/Product/9001",
          title: "Alpha private merchandise",
          grossMinor: 2000n,
        },
      ],
    });
    const scopedReport = await affiliateReport(context.organizationId);
    expect(scopedReport.orders).toHaveLength(1);
    expect(scopedReport.orders[0]).toMatchObject({
      name: "#9201",
      products: ["Creator jersey"],
      sold: 2,
      base: "2000",
      commission: "1000",
    });
    expect(JSON.stringify(scopedReport)).not.toContain(
      "Alpha private merchandise",
    );
    expect(
      (await affiliateReport(orgId)).orders.some((o) => o.name === "#101"),
    ).toBe(true);
    await db.affiliateAccount.update({
      where: { id: account.id },
      data: { status: "suspended" },
    });
    await expect(
      requirePartner(
        new Request("https://portal.example.test/portal/dashboard", {
          headers: { Cookie: cookie },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      requirePartner(
        new Request("https://portal.example.test/portal/dashboard", {
          headers: { Cookie: cookie.split(";")[0].slice(0, -8) + "tampered" },
        }),
      ),
    ).rejects.toMatchObject({ status: 302 });
  });
  it("queues signed-event metadata idempotently and leases retries without storing customer payloads", async () => {
    const { enqueueFinancialWebhook, processInboxBatch } =
      await import("../../app/services/shopify/inbox.server");
    process.env.SHOPIFY_SHOP = "inbox.myshopify.com";
    const payload = {
      admin_graphql_api_id: "gid://shopify/Order/111",
      customer: { email: "never-store@example.test" },
    };
    const [a, b] = await Promise.all([
      enqueueFinancialWebhook(
        process.env.SHOPIFY_SHOP,
        "ORDERS_PAID",
        "event-one",
        payload,
      ),
      enqueueFinancialWebhook(
        process.env.SHOPIFY_SHOP,
        "ORDERS_PAID",
        "event-one",
        payload,
      ),
    ]);
    expect(a.id).toBe(b.id);
    expect(a).not.toHaveProperty("customer");
    await expect(
      enqueueFinancialWebhook(
        "other.myshopify.com",
        "ORDERS_PAID",
        "other",
        payload,
      ),
    ).rejects.toMatchObject({ status: 403 });
    const admin = vi.fn().mockRejectedValue(new Error("No access"));
    await processInboxBatch(admin, 1);
    const retried = await db.webhookDelivery.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(retried.attempts).toBe(1);
    expect(retried.processedAt).toBeNull();
    expect(retried.claimToken).toBeNull();
    expect(retried.error).not.toContain("never-store");
  });
});
