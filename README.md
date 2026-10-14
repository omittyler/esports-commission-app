# Esports merchandise commission portal

First implementation pass for `omittyler/esports-commission-app`, following the supplied [PRD](PRD.md). Built from Shopify's official React Router TypeScript template, with PostgreSQL and Prisma.

Implemented: authenticated embedded admin, organization creation/settings/archive, effective-dated commission history, GraphQL catalog search, product/variant assignment and retirement, immutable sale/refund ledger, Team Alpha/Bravo seeds, standalone commission engine and persistence services, and financial correctness tests.

Live order/refund ingestion, Shopify metafield synchronization, partner authentication, payouts, ACH, Tapstitch, and cross-store features are deferred. The app does not process live sales yet.

## Local setup

Requires Node 24 (minimum 22.12), npm, PostgreSQL 17+ with `btree_gist`, and a Shopify developer account/development store. Docker is optional; the Compose file supplies a local database. Use development credentials only.

```sh
npm ci
cp .env.example .env
docker compose up -d
npm run setup
npm run db:seed
npm run config:link
npm run dev
```

PowerShell: use `Copy-Item .env.example .env` instead of `cp` if preferred. If using an existing PostgreSQL database, skip Compose and set `DATABASE_URL` first. The migration role must be able to create the `btree_gist` extension; have an operator install it first where extension privileges are restricted.

Configure the exact development shop in `SHOPIFY_SHOP`, fill in Shopify app credentials, and select your app when `config:link` prompts. Shopify CLI fills the actual `client_id` and manages development URLs. The checked-in URL and client ID are placeholders. An unset or different `SHOPIFY_SHOP` receives HTTP 403 on every admin loader/action.

The seed is rerunnable: Team Alpha starts at 20%, Team Bravo at 15%, both effective 2026-01-01 UTC. Existing settings/rate history remain intact on reruns. Assign real products from your development store using **Product assignments**.

### Local PostgreSQL without Docker

If PostgreSQL and Docker are unavailable, run `npm run db:local` in a separate terminal. This uses the installed development PostgreSQL runtime, listens only on `127.0.0.1:55432`, and preserves data in the ignored `.postgres-dev` folder. Set `DATABASE_URL=postgresql://commission:commission@127.0.0.1:55432/commission?schema=public` in `.env`, then run setup and seed as above. Keep the database terminal running; Ctrl+C stops it without deleting data. These credentials are for local development only.

### Testing on an existing live store

Shopify CLI's `app dev --store` accepts development or Plus sandbox stores, not ordinary live stores. To verify this app on a live store, link an app registration, configure a reachable HTTPS application URL and auth callbacks, select custom distribution, and install using that app's custom installation link. The live-store deployment needs its own hosted database and secret configuration; a local database alone does not make the app remotely available.

This pass requests only `read_products`. Catalog access reads Shopify; organization settings and assignments write only to this app's database. No order/refund webhook subscriptions are enabled. Keep sample assignments separate from any future production ingestion configuration. [Shopify custom distribution documentation](https://shopify.dev/docs/apps/launch/distribution).

## Environment variables

| Variable             | Purpose                                                                            |
| -------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection URL; migrations and application persistence                  |
| `SHOPIFY_API_KEY`    | Shopify app client ID                                                              |
| `SHOPIFY_API_SECRET` | Shopify app client secret, server only                                             |
| `SHOPIFY_APP_URL`    | Public HTTPS app URL; CLI manages dev tunnel URL                                   |
| `SHOPIFY_SHOP`       | Exact allowed `your-store.myshopify.com` domain                                    |
| `SHOP_CURRENCY`      | One allowed ISO currency, e.g. `USD`                                               |
| `SCOPES`             | `read_products` for this pass; matches app TOML                                    |
| `TEST_DATABASE_URL`  | Optional test DB URL; tests create a unique schema without resetting existing data |
| `PORT`               | Optional production HTTP port; defaults to 3000                                    |

Do not commit `.env`, session tokens, or shop secrets. No `read_orders`, `read_all_orders`, or product-write scopes are requested yet.

## Validation

```sh
npm test
npm run test:db
npm run lint
npm run typecheck
npm run build
```

`npm test` exercises the pure engine. `test:db` starts a disposable PostgreSQL process on localhost port 55439 when `TEST_DATABASE_URL` is absent, applies both migrations, and tests real Prisma persistence/SQL guards. It stops the process afterwards. If port 55439 is occupied, supply `TEST_DATABASE_URL` for a test database. CI uses PostgreSQL 17 and a unique test schema. Test schemas in an externally supplied database remain available for inspection; use a dedicated disposable database.

Coverage includes discounts, mixed carts and organizations, variant precedence, historical rates and reassignment, partial/full refunds, rounding conservation, huge integer amounts, stable source keys, concurrent duplicate orders/refunds, concurrent distinct over-refunds, mutation protection, overlapping history, and idempotent seeds.

## Repository structure

```text
app/
  components/OrganizationForm.tsx
  routes/
    app.tsx                         # authenticated admin shell
    app._index.tsx                   # home and financial definitions
    app.organizations._index.tsx     # list/create
    app.organizations.$id.tsx        # detail/settings/rate history
    app.products.tsx                 # catalog + assignment history
    auth.* / webhooks.app.*          # official scaffold auth/lifecycle
  services/
    auth.server.ts                   # single-shop guard
    admin.server.ts                  # audited settings/assignment writes
    shopify/catalog.ts               # verified GraphQL operations
    commissions/domain.ts            # independent exact-money engine
    commissions/ledger.server.ts     # atomic, idempotent persistence
prisma/
  schema.prisma
  seed.ts
  migrations/
    20261014000000_foundation/        # tables, indexes, foreign keys
    20261014000100_financial_guards/  # append-only and accounting guards
tests/
  commissions/domain.test.ts
  db/ledger.test.ts
.github/workflows/ci.yml
compose.yaml
DECISIONS.md
PRD.md
```

Organizations, commission rates, product assignments, orders, order lines, commission transactions, audit events and Shopify sessions are persisted. No partner or payout tables are added prematurely.

## Financial behavior

- Merchandise base = total line gross minus allocated discounts; shipping and tax are excluded before domain input.
- Money uses integer minor units (`BigInt`/PostgreSQL `BIGINT`). Percentage rates use basis points.
- Sale line commission rounds half up. Refunds reverse the original rounded commission proportionally using cumulative refunded merchandise, conserving the entire original commission on full refund.
- Assignment and rate periods are UTC and half-open. Variant assignment overrides product assignment. Rates/attribution are snapshotted on the immutable sale entry.
- Source keys use financial event + line IDs, never webhook delivery IDs. Serializability, unique keys, and SQL guards back idempotency and refund caps.
- Admin rate changes append future periods. Inactive organization status prevents new assignments; retire current assignments to stop earning. Existing ledger entries remain unchanged.

See [DECISIONS.md](DECISIONS.md) for tradeoffs and deferred integration details.

## Deployment and current limits

`npm run build` followed by `npm start` serves the production build. `npm run setup` generates Prisma and deploys migrations; run this as a release step using a migration role. Docker includes these steps through `docker-start`; adjust release orchestration before production. Use a restricted application DB role without DDL, superuser, or trigger-disabling privileges. Back up the database and retain the ledger.

Development-store installation/authenticated UI testing requires your Shopify credentials and was not performed during this first pass. Shopify CLI config validation also requires linking a real app before it can finish. GraphQL catalog operations were validated against the official 2026-10 schema. The toolkit's standalone UI validator failed due to missing React/JSX context; project TypeScript compilation verifies the installed Polaris types.

Dependency audit findings inherited from scaffold/tooling must be reviewed before a production release; compatible `npm audit fix` updates were attempted. Do not force major framework/ORM downgrades merely to suppress audit output.

## Next milestones

1. Install on the development store and verify organization/assignment screens in Shopify admin.
2. Add isolated Shopify normalization adapters, signed order/refund webhooks, a durable inbox and reconciliation; reuse the tested ledger services.
3. Add metafield synchronization with reconciliation, order edits, historical import and admin ledger/reporting.
4. Implement partner auth and payouts only as separately reviewed milestones.

The original requirements are retained in `PRD.md` and `CODEX_PROMPT.md`.
