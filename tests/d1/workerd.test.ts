import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { Session } from "@shopify/shopify-api";
import db, { withDatabase } from "../../cloudflare/database.server";
import { authClient, limitAuth } from "../../cloudflare/email-auth.server";
import {
  requirePartner,
  sessionStore,
  revokeCurrentSession,
} from "../../app/services/affiliates/auth.server";
import {
  registerVerifiedApplicant,
  reviewAffiliate,
} from "../../app/services/affiliates/admin.server";
import {
  recordOrder,
  recordRefund,
} from "../../app/services/commissions/ledger.server";
import { recordPayment } from "../../app/services/payments/payments.server";
import {
  discoverOrderUpdates,
  requestCatchUp,
} from "../../app/services/shopify/catchup.server";
import {
  processInboxBatchDetailed,
  enqueueFinancialWebhook,
} from "../../app/services/shopify/inbox.server";
let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
const run = <T>(fn: () => T) => withDatabase(proxy.env.DB, fn);
beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: "tests/d1/wrangler.json",
    persist: false,
  });
  const statements = unstable_splitSqlQuery(
    readFileSync("cloudflare/migrations/0001_portal.sql", "utf8"),
  );
  for (let i = 0; i < statements.length; i += 20)
    await proxy.env.DB.batch(
      statements.slice(i, i + 20).map((s) => proxy.env.DB.prepare(s)),
    );
  process.env.SHOP_CURRENCY = "USD";
  process.env.SHOPIFY_SHOP = "d1-test.myshopify.com";
  process.env.PORTAL_URL = "https://portal.example.test";
  process.env.RESEND_API_KEY = "test-only-not-a-provider-key";
  process.env.AUTH_FROM_EMAIL = "Crafted <test@auth.example.test>";
  process.env.PORTAL_SESSION_SECRET =
    "test-only-secret-with-more-than-32-characters";
}, 60000);
afterAll(async () => {
  vi.unstubAllGlobals();
  await proxy?.dispose();
});
describe("Cloudflare local D1 runtime", () => {
  it("persists and refreshes Shopify sessions through the official storage adapter", () => run(async () => {
    const storage = new PrismaSessionStorage(db);
    const session = new Session({ id: "offline_d1-adapter-test", shop: "d1-test.myshopify.com", state: "test-only", isOnline: false });
    session.accessToken = "fake-token-not-a-credential";
    expect(await storage.storeSession(session)).toBe(true);
    session.accessToken = "fake-refreshed-token-not-a-credential";
    expect(await storage.storeSession(session)).toBe(true);
    expect((await storage.loadSession(session.id))!.accessToken).toBe(session.accessToken);
    await storage.deleteSession(session.id);
    expect(await storage.loadSession(session.id)).toBeUndefined();
  }));
  it("applies the migration, posts financial batches, rolls back failures, and seals payments", () =>
    run(async () => {
      const org = await db.organization.create({
        data: {
          name: "Runtime Team",
          slug: "runtime-team",
          rates: {
            create: { rateBps: 100, effectiveFrom: new Date("2026-01-01") },
          },
        },
      });
      await db.affiliateAccount.create({
        data: {
          firstName: "Native",
          lastName: "Test",
          email: "runtime@example.test",
          displayName: "Runtime",
          type: "creator",
          paypalEmail: "pay@example.test",
          authSubject: crypto.randomUUID(),
          verifiedAt: new Date(),
          status: "approved",
          organizationId: org.id,
        },
      });
      await db.productAssignment.create({
        data: {
          organizationId: org.id,
          productGid: "gid://shopify/Product/20",
          variantGid: null,
          displayTitle: "Runtime jersey",
          effectiveFrom: new Date("2026-01-01"),
        },
      });
      const order = {
        orderRef: "gid://shopify/Order/20",
        displayName: "#20",
        occurredAt: new Date("2026-01-02"),
        currency: "USD",
        lines: [
          {
            lineGid: "gid://shopify/LineItem/20",
            productGid: "gid://shopify/Product/20",
            variantGid: null,
            title: "Runtime jersey",
            quantity: 1,
            grossMinor: 10000n,
            discountMinor: 0n,
          },
        ],
      };
      const sales = await Promise.all([recordOrder(order), recordOrder(order)]);
      expect(sales[0][0].id).toBe(sales[1][0].id);
      const form = new FormData();
      Object.entries({
        currency: "USD",
        amount: "1.00",
        paidAt: "2026-01-03",
        method: "paypal",
        reference: "runtime-payment",
        idempotencyKey: crypto.randomUUID(),
        confirmed: "yes",
      }).forEach(([k, v]) => form.set(k, v));
      await recordPayment(org.id, form, "runtime-admin");
      expect(await db.commissionPayment.count()).toBe(1);
      expect(
        (await proxy.env.DB.prepare(
          'SELECT count(*) AS n FROM "PaymentSeal"',
        ).first<{ n: number }>())!.n,
      ).toBe(1);
      await recordRefund({
        saleId: sales[0][0].id,
        refundRef: "runtime-refund",
        refundMinor: 10000n,
        currency: "USD",
        occurredAt: new Date("2026-01-04"),
      });
      expect(
        (
          await db.commissionTransaction.aggregate({
            _sum: { commissionMinor: true },
          })
        )._sum.commissionMinor,
      ).toBe(0n);
      await expect(
        recordOrder({
          ...order,
          orderRef: "gid://shopify/Order/21",
          lines: [
            { ...order.lines[0], lineGid: "gid://shopify/LineItem/21" },
            { ...order.lines[0], lineGid: "gid://shopify/LineItem/21" },
          ],
        }),
      ).rejects.toThrow();
      expect(await db.order.count()).toBe(1);
    }));
  it("uses browser-bound, single-use codes and hashed, revocable sessions without Supabase", () =>
    run(async () => {
      let code = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, options) => {
          code = JSON.parse(options.body).text.match(/\b\d{6}\b/)[0];
          return new Response(JSON.stringify({ id: "fake-delivery" }), {
            status: 200,
          });
        }),
      );
      const challenge = await authClient().auth.signInWithOtp({
        email: "native@example.test",
        options: { shouldCreateUser: true },
      });
      expect(challenge.error).toBeNull();
      const row = await proxy.env.DB.prepare(
        'SELECT * FROM "AuthChallenge" WHERE id=?',
      )
        .bind(challenge.challengeId)
        .first();
      expect(JSON.stringify(row)).not.toContain(code);
      expect(
        (
          await authClient().auth.verifyOtp({
            email: "attacker@example.test",
            token: code,
            type: "email",
            challengeId: challenge.challengeId,
          })
        ).error,
      ).toBeTruthy();
      expect(
        (
          await authClient().auth.verifyOtp({
            email: "native@example.test",
            token: code,
            type: "email",
            challengeId: crypto.randomUUID(),
          })
        ).error,
      ).toBeTruthy();
      const verify = () =>
        authClient().auth.verifyOtp({
          email: "native@example.test",
          token: code,
          type: "email",
          challengeId: challenge.challengeId,
        });
      const results = await Promise.all([verify(), verify()]);
      expect(results.filter((r) => !r.error)).toHaveLength(1);
      const token = results.find((r) => !r.error)!.data.session!.access_token;
      const identity = (await authClient().auth.getUser(token)).data.user!;
      const account = await registerVerifiedApplicant(
        {
          type: "creator",
          firstName: "Native",
          lastName: "Creator",
          email: "native@example.test",
          displayName: "Native creator",
          organizationRole: null,
          paypalEmail: "pay@example.test",
        },
        identity.id,
      );
      const session = await sessionStore().getSession();
      session.set("accessToken", token);
      const request = new Request(
        "https://portal.example.test/portal/products?organizationId=forged",
        { headers: { Cookie: await sessionStore().commitSession(session) } },
      );
      await expect(requirePartner(request)).rejects.toMatchObject({
        status: 403,
      });
      const approved = await reviewAffiliate(account.id, "approved", "admin");
      expect((await requirePartner(request)).organizationId).toBe(
        approved.organizationId,
      );
      const stored = await proxy.env.DB.prepare(
        'SELECT "tokenHash" FROM "AuthSession" WHERE email=?',
      )
        .bind(account.email)
        .first<{ tokenHash: string }>();
      expect(stored!.tokenHash).toBe(
        createHash("sha256").update(token).digest("hex"),
      );
      await revokeCurrentSession(request);
      expect((await authClient().auth.getUser(token)).error).toBeTruthy();
      await expect(requirePartner(request)).rejects.toMatchObject({
        status: 302,
      });
      vi.unstubAllGlobals();
    }));
  it("limits guesses, expires challenges, hides unknown accounts, and caps request rates", () =>
    run(async () => {
      let code = "";
      const send = vi.fn(async (_url, options) => {
        code = JSON.parse(options.body).text.match(/\b\d{6}\b/)[0];
        return new Response("{}", { status: 200 });
      });
      vi.stubGlobal("fetch", send);
      const unknown = await authClient().auth.signInWithOtp({
        email: "unknown@example.test",
        options: { shouldCreateUser: false },
      });
      expect(unknown.error).toBeNull();
      expect(send).not.toHaveBeenCalled();
      const challenge = await authClient().auth.signInWithOtp({
        email: "guesses@example.test",
        options: { shouldCreateUser: true },
      });
      const verify = (token: string) =>
        authClient().auth.verifyOtp({
          email: "guesses@example.test",
          token,
          type: "email",
          challengeId: challenge.challengeId,
        });
      for (let i = 0; i < 5; i++)
        expect((await verify("000000")).error).toBeTruthy();
      expect((await verify(code)).error).toBeTruthy();
      const expired = await authClient().auth.signInWithOtp({
        email: "expired@example.test",
        options: { shouldCreateUser: true },
      });
      await proxy.env.DB.prepare(
        'UPDATE "AuthChallenge" SET "expiresAt"=0 WHERE id=?',
      )
        .bind(expired.challengeId)
        .run();
      expect(
        (
          await authClient().auth.verifyOtp({
            email: "expired@example.test",
            token: code,
            type: "email",
            challengeId: expired.challengeId,
          })
        ).error,
      ).toBeTruthy();
      for (let i = 0; i < 5; i++) await limitAuth("login", "rate@example.test");
      await expect(
        limitAuth("login", "rate@example.test"),
      ).rejects.toMatchObject({ status: 429 });
      vi.unstubAllGlobals();
    }));
  it("saves discovery/checkpoints atomically, deduplicates rescans and leases one event per tick", () =>
    run(async () => {
      const now = new Date(),
        shop = process.env.SHOPIFY_SHOP!;
      const response = () =>
        new Response(
          JSON.stringify({
            data: {
              orders: {
                nodes: [
                  {
                    id: "gid://shopify/Order/500",
                    createdAt: new Date(now.getTime() - 86400000).toISOString(),
                    updatedAt: new Date(now.getTime() - 3600000).toISOString(),
                    displayFinancialStatus: "PAID",
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          }),
        );
      expect(
        (await discoverOrderUpdates(async () => response(), shop)).status,
      ).toBe("complete");
      expect(await db.webhookDelivery.count()).toBe(1);
      await requestCatchUp(shop);
      expect(
        (await discoverOrderUpdates(async () => response(), shop)).queued,
      ).toBe(0);
      expect(await db.webhookDelivery.count()).toBe(1);
      const payload = { admin_graphql_api_id: "gid://shopify/Order/500" };
      const concurrent = await Promise.all([
        enqueueFinancialWebhook(shop, "ORDERS_PAID", "duplicate", payload),
        enqueueFinancialWebhook(shop, "ORDERS_PAID", "duplicate", payload),
      ]);
      expect(concurrent[0].id).toBe(concurrent[1].id);
      let calls = 0;
      await Promise.all(
        [1, 2].map(() =>
          processInboxBatchDetailed(async () => {
            calls++;
            throw new Error("Test provider failure");
          }, 1),
        ),
      );
      expect(calls).toBe(2);
      expect(await db.webhookDelivery.count({ where: { attempts: 1 } })).toBe(
        2,
      );
      expect(
        await db.webhookDelivery.count({ where: { processedAt: null } }),
      ).toBe(2);
    }));
});
