// Verified against Shopify Admin GraphQL 2026-10. No prices or customer data needed.
export const CATALOG_QUERY = `#graphql
  query CommissionCatalog($query: String, $after: String) {
    productVariants(first: 25, query: $query, after: $after) {
      nodes { id title product { id title } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
export const ASSIGNMENT_QUERY = `#graphql
  query AssignmentTarget($id: ID!) {
    node(id: $id) {
      ... on Product { id title }
      ... on ProductVariant { id title product { id title } }
    }
  }
`;
export type CatalogVariant = {
  id: string;
  title: string;
  product: { id: string; title: string };
};

export const COLLECTIONS_QUERY = `#graphql
  query CommissionCollections($query: String, $after: String) {
    collections(first: 25, query: $query, after: $after) {
      nodes { id title }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
export const COLLECTION_PRODUCTS_QUERY = `#graphql
  query CommissionCollectionProducts($id: ID!, $after: String) {
    collection(id: $id) {
      id title
      products(first: 100, after: $after) {
        nodes { id title }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;
export type CatalogProduct = { id: string; title: string };
