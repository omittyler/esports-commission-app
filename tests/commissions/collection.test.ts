import { describe, expect, it, vi } from "vitest";
import { collectionProducts } from "../../app/services/shopify/collection.server";

const gid = "gid://shopify/Collection/1";
const page = (ids: number[], next: string | null = null) =>
  new Response(
    JSON.stringify({
      data: {
        collection: {
          id: gid,
          title: "Alpha Collection",
          products: {
            nodes: ids.map((id) => ({
              id: `gid://shopify/Product/${id}`,
              title: `Product ${id}`,
            })),
            pageInfo: { hasNextPage: next !== null, endCursor: next },
          },
        },
      },
    }),
  );
describe("collection membership snapshots", () => {
  it("loads every page rather than just the first page", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(page([1, 2], "next"))
      .mockResolvedValueOnce(page([3]));
    const result = await collectionProducts(graphql, gid);
    expect(result.products).toHaveLength(3);
    expect(graphql.mock.calls[1][1].variables.after).toBe("next");
  });
  it("fails instead of returning partially fetched products", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(page([1], "next"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: "Throttled" }] })),
      );
    await expect(collectionProducts(graphql, gid)).rejects.toThrow(
      "No assignments were saved",
    );
  });
  it("rejects duplicate members caused by shifting pagination", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(page([1], "next"))
      .mockResolvedValueOnce(page([1]));
    await expect(collectionProducts(graphql, gid)).rejects.toThrow(
      "membership changed",
    );
  });
  it("returns an empty preview and rejects malformed collection IDs", async () => {
    const graphql = vi.fn().mockResolvedValue(page([]));
    expect((await collectionProducts(graphql, gid)).products).toEqual([]);
    await expect(
      collectionProducts(graphql, "gid://shopify/Product/1"),
    ).rejects.toThrow("Invalid collection");
  });
  it("rejects nonadvancing cursors and oversized collections", async () => {
    const loop = vi
      .fn()
      .mockResolvedValueOnce(page([1], "next"))
      .mockResolvedValueOnce(page([2], "next"));
    await expect(collectionProducts(loop, gid)).rejects.toThrow(
      "complete collection",
    );
    const large = vi
      .fn()
      .mockResolvedValue(page(Array.from({ length: 1001 }, (_, i) => i + 1)));
    await expect(collectionProducts(large, gid)).rejects.toThrow("1,000");
  });
});
