import { describe, expect, it, vi } from "vitest";
import { collectionStorefrontLinks } from "../../app/services/shopify/collection-links.server";

const gid = (id: number) => `gid://shopify/Collection/${id}`;
const response = (nodes: unknown[], url = "https://crafted.gg") =>
  new Response(
    JSON.stringify({ data: { shop: { primaryDomain: { url } }, nodes } }),
  );

describe("assigned collection storefront links", () => {
  it("uses the actual store domain and current handles, ignoring unrequested collection IDs", async () => {
    const graphql = vi.fn().mockResolvedValue(
      response([
        { id: gid(1), handle: "renamed-team-collection" },
        { id: gid(9), handle: "another-affiliate" },
      ]),
    );
    const links = await collectionStorefrontLinks(graphql, [gid(1), gid(1)]);
    expect([...links]).toEqual([
      [gid(1), "https://crafted.gg/collections/renamed-team-collection"],
    ]);
    expect(graphql.mock.calls[0][1].variables.ids).toEqual([gid(1)]);
  });
  it("makes no requests for empty assignments and rejects non-collection IDs before lookup", async () => {
    const graphql = vi.fn();
    expect((await collectionStorefrontLinks(graphql, [])).size).toBe(0);
    await expect(
      collectionStorefrontLinks(graphql, ["gid://shopify/Product/1"]),
    ).rejects.toThrow("Invalid assigned collection");
    expect(graphql).not.toHaveBeenCalled();
  });
  it("omits deleted collections and invalid handles rather than inventing links", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValue(
        response([
          null,
          { id: gid(1), handle: "../../private" },
          { id: gid(2), handle: "" },
        ]),
      );
    expect(
      (await collectionStorefrontLinks(graphql, [gid(1), gid(2)])).size,
    ).toBe(0);
  });
  it("rejects unsafe domains and failed or partial API responses", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValue(
        response([{ id: gid(1), handle: "team" }], "javascript:alert(1)"),
      );
    await expect(collectionStorefrontLinks(graphql, [gid(1)])).rejects.toThrow(
      "Invalid storefront address",
    );
    graphql.mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [{ message: "Throttled" }],
          data: { nodes: [] },
        }),
      ),
    );
    await expect(collectionStorefrontLinks(graphql, [gid(1)])).rejects.toThrow(
      "temporarily unavailable",
    );
  });
  it("batches large assignment histories within Shopify's 250-ID limit", async () => {
    const ids = Array.from({ length: 251 }, (_, index) => gid(index + 1));
    const graphql = vi
      .fn()
      .mockImplementation((_query, options) =>
        Promise.resolve(
          response(
            options.variables.ids.map((id: string) => ({
              id,
              handle: `team-${id.split("/").pop()}`,
            })),
          ),
        ),
      );
    expect((await collectionStorefrontLinks(graphql, ids)).size).toBe(251);
    expect(
      graphql.mock.calls.map((call) => call[1].variables.ids.length),
    ).toEqual([250, 1]);
  });
});
