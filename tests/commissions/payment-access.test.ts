import { beforeEach, describe, expect, it, vi } from "vitest";
const authenticateAdmin = vi.hoisted(() => vi.fn());
vi.mock("../../app/shopify.server", () => ({
  authenticate: { admin: authenticateAdmin },
}));
vi.mock("../../app/db.server", () => ({
  default: {
    $transaction: vi.fn(),
    affiliateAccount: { findUniqueOrThrow: vi.fn() },
  },
}));
import { requireAdminOrigin } from "../../app/services/auth.server";
import { loader as overview } from "../../app/routes/app.payments";
import { action as affiliateAction } from "../../app/routes/app.affiliates.$id";
import db from "../../app/db.server";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SHOPIFY_SHOP = "allowed.myshopify.com";
  process.env.SHOPIFY_APP_URL = "https://app.example.test";
});
describe("admin payment access", () => {
  const args = (request: Request) => ({
    request,
    params: { id: "11111111-1111-4111-8111-111111111111" },
    context: {},
    url: new URL(request.url),
    pattern: "/app/affiliates/:id",
  });
  it("rejects another shop before reading payment balances", async () => {
    authenticateAdmin.mockResolvedValue({
      session: { shop: "other.myshopify.com" },
    });
    await expect(
      overview(args(new Request("https://app.example.test/app/payments"))),
    ).rejects.toMatchObject({ status: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("requires Shopify authentication before payment writes", async () => {
    authenticateAdmin.mockRejectedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(
      affiliateAction(
        args(
          new Request("https://app.example.test/app/affiliates/test", {
            method: "POST",
          }),
        ),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(db.affiliateAccount.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("denies missing or foreign origins before processing a payment form", async () => {
    authenticateAdmin.mockResolvedValue({
      session: { shop: "allowed.myshopify.com" },
    });
    for (const origin of [null, "https://attacker.example.test"]) {
      const request = new Request(
        "https://app.example.test/app/affiliates/test",
        { method: "POST", headers: origin ? { Origin: origin } : {} },
      );
      await expect(affiliateAction(args(request))).rejects.toMatchObject({
        status: 403,
      });
    }
    expect(db.affiliateAccount.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("keeps affiliate credits separate from payable totals and separates currencies", async () => {
    authenticateAdmin.mockResolvedValue({
      session: { shop: "allowed.myshopify.com" },
    });
    vi.mocked(db.$transaction).mockResolvedValue([
      [
        {
          id: "a",
          name: "Alpha",
          account: { id: "account-a", status: "approved" },
        },
        {
          id: "b",
          name: "Bravo",
          account: { id: "account-b", status: "approved" },
        },
      ],
      [
        {
          organizationId: "a",
          currency: "USD",
          _sum: { commissionMinor: 10000n },
        },
        {
          organizationId: "b",
          currency: "USD",
          _sum: { commissionMinor: 1000n },
        },
        {
          organizationId: "b",
          currency: "EUR",
          _sum: { commissionMinor: 2000n },
        },
      ],
      [{ organizationId: "b", currency: "USD", _sum: { amountMinor: 3000n } }],
    ]);
    Object.assign(db, {
      organization: { findMany: vi.fn() },
      commissionTransaction: { groupBy: vi.fn() },
      commissionPayment: { groupBy: vi.fn() },
    });
    const result = await overview(
      args(new Request("https://app.example.test/app/payments")),
    );
    expect(result.data.totals.find((t) => t.currency === "USD")).toMatchObject({
      commission: "11000",
      paid: "3000",
      outstanding: "8000",
      due: "10000",
      credit: "2000",
    });
    expect(result.data.totals.find((t) => t.currency === "EUR")).toMatchObject({
      commission: "2000",
      paid: "0",
      due: "2000",
      credit: "0",
    });
    expect(result.init?.headers).toMatchObject({
      "Cache-Control": "private, no-store",
    });
  });
  it("accepts the configured app origin", () => {
    expect(() =>
      requireAdminOrigin(
        new Request("https://app.example.test/app/affiliates/test", {
          method: "POST",
          headers: { Origin: "https://app.example.test" },
        }),
      ),
    ).not.toThrow();
  });
});
