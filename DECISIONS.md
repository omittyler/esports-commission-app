# First-pass decisions

- The local `PRD.md` is authoritative; the user's first-pass instruction excludes payouts, partner auth, ACH, Tapstitch, and cross-store work. Their tables and screens are intentionally absent.
- Start from Shopify's official TypeScript React Router template (2026-10 API), retain its authenticated session adapter and signature-verified lifecycle webhooks. Use SingleMerchant distribution. Every admin loader and action additionally requires the exact configured `SHOPIFY_SHOP`; an unset value fails closed.
- PostgreSQL with Prisma 6. Store money as signed `BIGINT` minor units and rates as integer basis points (20% = 2000). The commission domain receives normalized minor units; it does not parse Shopify payloads, decimal currency strings, shipping, or taxes. Currency is persisted on orders, lines, and every ledger entry. Enforce the configured shop currency at order ingestion. Future normalization must use each currency's correct minor-unit exponent.
- Merchandise base is the entire line's gross merchandise amount minus all allocated discounts. Quantity is informational; amounts must already include quantity. A refund adapter must provide the discounted merchandise amount refunded, including quantity-based allocations, and exclude shipping and tax.
- Round half up once per sale line. Refunds calculate the cumulative refunded proportion of the original rounded commission, subtracting prior reversals. This conserves every cent when a line is fully refunded, including many small partial refunds. Persist zero commission entries where the rate or rounded amount is zero.
- Rates and assignments use UTC half-open intervals `[from, to)`. Exclusion constraints prevent conflicting intervals per organization/target. Variant assignment takes precedence over product assignment. Missing rates and conflicting histories fail explicitly.
- The organization does not duplicate a mutable current-rate field: derive it from history. Admins append future rates and assignments; they cannot rewrite history. Names/status can change, slugs remain stable, and deactivation archives the organization. Inactive status prevents new assignments but does not cancel existing contracts: explicitly retire assignments to stop accrual. This avoids retroactively suppressing delayed sales for an inactive organization.
- Seed Alpha at 20% and Bravo at 15%, effective 2026-01-01 UTC. Seed reruns do not overwrite admin changes. No fabricated Shopify product IDs are seeded.
- Canonical DB assignment is implemented first. Shopify metafield synchronization (`partner_commission.organization_id`) is deferred until integration work; no Shopify writes or `write_products` scope in this pass. Product catalog reads and target verification use GraphQL only.
- Ledger, orders, lines, and audit events are append-only with SQL triggers. Financial inserts verify relationships, currency, rate/assignment snapshots, signs, exact sale formula, variant precedence, and cumulative refund limits. A runtime database role must not have DDL, trigger-disable, or superuser privileges; privileged operators can bypass triggers.
- Event keys use JSON tuples `[type, order-or-refund-GID, line-GID]`, independent of webhook delivery IDs. Unique keys and event-per-line indexes plus serializable transactions and bounded retries handle duplicate/concurrent events. Changed financial replays fail for reconciliation rather than silently rewriting posted history. Order edits/manual adjustments are not implemented.
- Standalone persistence services are tested but not exposed via routes or wired to order/refund webhooks. Only scaffold lifecycle webhooks are enabled. Live ingestion requires normalized adapters, signature checks, durable event inbox, reconciliation, and order/refund timing handling.
- Store only order display name, product/line identifiers, merchandise amounts and snapshots; no customer email, address, or phone in financial models. Audit records capture the authenticated shop in this pass; staff-specific attribution requires a subsequent online-session policy.
- Shopify credentials and development-store installation are external setup steps because no credentials were supplied. Static build/type checks and real PostgreSQL integration checks run locally.

## References verified during implementation

- [Official React Router template](https://github.com/Shopify/shopify-app-template-react-router)
- [GraphQL productVariants](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/productVariants)
- [GraphQL node](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/node)
- [Polaris web components](https://shopify.dev/docs/api/app-home/using-polaris-components)
- [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit)
