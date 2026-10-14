import { COLLECTION_PRODUCTS_QUERY, type CatalogProduct } from "./catalog";

type Graphql = (
  query: string,
  options: { variables: { id: string; after: string | null } },
) => Promise<Response>;
/** Materialize current membership before starting the database transaction. */
export async function collectionProducts(
  graphql: Graphql,
  collectionGid: string,
) {
  if (!/^gid:\/\/shopify\/Collection\/\d+$/.test(collectionGid))
    throw new Error("Invalid collection");
  const products: CatalogProduct[] = [];
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let after: string | null = null;
  let title = "";
  do {
    const response = await graphql(COLLECTION_PRODUCTS_QUERY, {
      variables: { id: collectionGid, after },
    });
    const body = (await response.json()) as {
      errors?: unknown;
      data?: {
        collection: {
          id: string;
          title: string;
          products: {
            nodes: CatalogProduct[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        } | null;
      };
    };
    const collection = body.data?.collection;
    if (
      !response.ok ||
      body.errors ||
      !collection ||
      collection.id !== collectionGid
    )
      throw new Error(
        "Unable to load the complete collection from Shopify. No assignments were saved.",
      );
    title = collection.title;
    for (const product of collection.products.nodes) {
      if (
        !/^gid:\/\/shopify\/Product\/\d+$/.test(product.id) ||
        seen.has(product.id)
      )
        throw new Error(
          "Collection membership changed during loading. Refresh and try again.",
        );
      seen.add(product.id);
      products.push(product);
      if (products.length > 1000)
        throw new Error(
          "Collections above 1,000 products are not supported in one action. No assignments were saved.",
        );
    }
    if (!collection.products.pageInfo.hasNextPage) break;
    after = collection.products.pageInfo.endCursor;
    if (!after || cursors.has(after))
      throw new Error(
        "Unable to load the complete collection. No assignments were saved.",
      );
    cursors.add(after);
  } while (after);
  return { collectionGid, title, products };
}
