export const COLLECTION_LINKS_QUERY = `#graphql
  query PartnerCollectionLinks($ids: [ID!]!) {
    shop { primaryDomain { url } }
    nodes(ids: $ids) {
      ... on Collection { id handle }
    }
  }
`;

type Graphql = (
  query: string,
  options: { variables: { ids: string[] } },
) => Promise<Response>;

/** IDs come exclusively from the authenticated affiliate's assignment history. */
export async function collectionStorefrontLinks(
  graphql: Graphql,
  ids: string[],
) {
  const requested = [...new Set(ids)];
  if (requested.some((id) => !/^gid:\/\/shopify\/Collection\/\d+$/.test(id)))
    throw new Error("Invalid assigned collection");
  const links = new Map<string, string>();
  for (let offset = 0; offset < requested.length; offset += 250) {
    const batch = requested.slice(offset, offset + 250);
    const response = await graphql(COLLECTION_LINKS_QUERY, {
      variables: { ids: batch },
    });
    const body = (await response.json()) as {
      errors?: unknown;
      data?: {
        shop?: { primaryDomain?: { url?: string } };
        nodes?: ({ id?: string; handle?: string } | null)[];
      };
    };
    if (!response.ok || body.errors || !Array.isArray(body.data?.nodes))
      throw new Error("Collection links are temporarily unavailable");
    const origin = new URL(body.data?.shop?.primaryDomain?.url ?? "");
    if (origin.protocol !== "https:" || origin.username || origin.password)
      throw new Error("Invalid storefront address");
    for (const node of body.data.nodes) {
      if (
        node?.id &&
        batch.includes(node.id) &&
        typeof node.handle === "string" &&
        node.handle.length > 0 &&
        /^[a-zA-Z0-9_-]+$/.test(node.handle)
      )
        links.set(
          node.id,
          new URL(`/collections/${encodeURIComponent(node.handle)}`, origin)
            .href,
        );
    }
  }
  return links;
}
