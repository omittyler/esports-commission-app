import { beforeEach, describe, expect, it, vi } from "vitest";
const authenticateAdmin = vi.hoisted(() => vi.fn());
const requestScan = vi.hoisted(() => vi.fn());
vi.mock("../../app/shopify.server", () => ({
  authenticate: { admin: authenticateAdmin },
}));
vi.mock("../../app/services/shopify/catchup.server", () => ({
  requestCatchUp: requestScan,
}));
vi.mock("../../app/db.server", () => ({
  default: { $transaction: vi.fn(), webhookDelivery: { updateMany: vi.fn() } },
}));
import { action } from "../../app/routes/app.ingestion";
import db from "../../app/db.server";
beforeEach(() => {
  vi.clearAllMocks();
  process.env.SHOPIFY_APP_URL = "https://app.example.test";
  process.env.SHOPIFY_SHOP = "allowed.myshopify.com";
  authenticateAdmin.mockResolvedValue({
    session: { shop: process.env.SHOPIFY_SHOP, scope: "read_orders" },
    admin: { graphql: vi.fn() },
  });
});
const args = (intent: string, origin = "https://app.example.test") => {
  const form = new FormData();
  form.set("intent", intent);
  const request = new Request("https://app.example.test/app/ingestion", {
    method: "POST",
    headers: { Origin: origin },
    body: form,
  });
  return {
    request,
    params: {},
    context: {},
    url: new URL(request.url),
    pattern: "/app/ingestion",
  };
};
describe("catch-up admin actions", () => {
  it("requires the allowed Shopify shop and an approved order scope", async () => {
    authenticateAdmin.mockResolvedValueOnce({
      session: { shop: "wrong.myshopify.com", scope: "read_orders" },
    });
    await expect(action(args("catchup"))).rejects.toMatchObject({
      status: 403,
    });
    authenticateAdmin.mockResolvedValueOnce({
      session: { shop: process.env.SHOPIFY_SHOP, scope: "read_products" },
    });
    expect(await action(args("catchup"))).toMatchObject({
      init: { status: 403 },
    });
    expect(requestScan).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests before resetting checkpoints or retrying deliveries", async () => {
    await expect(
      action(args("restart", "https://attacker.example.test")),
    ).rejects.toMatchObject({ status: 403 });
    expect(requestScan).not.toHaveBeenCalled();
    expect(db.webhookDelivery.updateMany).not.toHaveBeenCalled();
  });
  it("requests a normal or explicit restart without reading order payloads", async () => {
    await action(args("catchup"));
    expect(requestScan).toHaveBeenLastCalledWith(
      process.env.SHOPIFY_SHOP,
      false,
    );
    await action(args("restart"));
    expect(requestScan).toHaveBeenLastCalledWith(
      process.env.SHOPIFY_SHOP,
      true,
    );
  });
  it("retries only unprocessed failed work from this shop with no live lease", async () => {
    vi.mocked(db.webhookDelivery.updateMany).mockResolvedValue({ count: 2 });
    const response = await action(args("retry"));
    expect(response).toMatchObject({
      success: true,
      message: expect.stringContaining("2 failed"),
    });
    expect(db.webhookDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shop: process.env.SHOPIFY_SHOP,
          processedAt: null,
          error: { not: null },
          OR: expect.any(Array),
        }),
      }),
    );
  });
});
