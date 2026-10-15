import { describe, expect, it, vi } from "vitest";
import { loader as landing } from "../../app/routes/_index/route";
import { loader as health } from "../../app/routes/health";
import db from "../../app/db.server";

vi.mock("../../app/db.server", () => ({ default: { $queryRaw: vi.fn() } }));

describe("hosting entry points", () => {
  it("opens partner login from the bare portal address", () => {
    const response = landing({
      request: new Request("https://portal.crafted.gg/"),
      params: {},
      context: {},
      url: new URL("https://portal.crafted.gg/"),
      pattern: "/",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/portal/login");
  });

  it("preserves Shopify's embedded launch parameters", () => {
    const response = landing({
      request: new Request(
        "https://portal.crafted.gg/?shop=example.myshopify.com&embedded=1&host=example-host",
      ),
      params: {},
      context: {},
      url: new URL("https://portal.crafted.gg/"),
      pattern: "/",
    });
    expect(response.headers.get("Location")).toBe(
      "/app?shop=example.myshopify.com&embedded=1&host=example-host",
    );
  });

  it("reports healthy only when the database responds", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValueOnce([{ "?column?": 1 }]);
    const response = await health();
    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not expose database errors to a public health probe", async () => {
    vi.mocked(db.$queryRaw).mockRejectedValueOnce(
      new Error("private connection details"),
    );
    const response = await health();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Unavailable");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
