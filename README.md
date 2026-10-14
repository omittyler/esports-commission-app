# Esports merchandise commission portal

Commission and affiliate portal for `omittyler/esports-commission-app`, following the supplied [PRD](PRD.md) and subsequent [affiliate requirements](AFFILIATE_PORTAL_REQUIREMENTS.md). Built from Shopify's official React Router TypeScript template, with PostgreSQL and Prisma.

Implemented: authenticated embedded admin, organization settings/rate history, Organization/Creator registration, managed email-code sign-in and approval, affiliates list/detail, versioned percentage/fixed-item programs, product/variant and current-collection assignments, immutable sale/refund ledger, scoped partner product/order reports, signed financial webhook inbox and reconciliation worker, Team Alpha/Bravo seeds, and accounting/security tests.

The temporary app serves the new screens. Registration and live order processing are **not active yet**: managed sign-in configuration and Shopify order-access approval are required. See [PORTAL_SETUP.md](PORTAL_SETUP.md) for activation, exact accounting rules, and verified limits. Shopify metafield synchronization, payouts, ACH, Tapstitch, and cross-store features remain deferred.

Product assignments supports either an individual product/variant or the current products in a Shopify collection. Search and preview a collection, choose an organization and future effective timestamp, then save. Existing product/variant assignments are skipped and reported; eligible products are saved together. Later collection membership changes do not change the saved snapshot. Up to 1,000 current products can be assigned per collection action.

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

Configure the exact allowed shop in `SHOPIFY_SHOP`, fill in Shopify app credentials, and select your app when `config:link` prompts. Shopify CLI fills the actual `client_id` and manages development URLs. The app registration is linked; configure the application URL for the environment you run. An unset or different `SHOPIFY_SHOP` receives HTTP 403 on every admin loader/action.

The seed is rerunnable: Team Alpha starts at 20%, Team Bravo at 15%, both effective 2026-01-01 UTC. Existing settings/rate history remain intact on reruns. Assign real products from your development store using **Product assignments**.

### Local PostgreSQL without Docker

If PostgreSQL and Docker are unavailable, run `npm run db:local` in a separate terminal. This uses the installed development PostgreSQL runtime, listens only on `127.0.0.1:55432`, and preserves data in the ignored `.postgres-dev` folder. Set `DATABASE_URL=postgresql://commission:commission@127.0.0.1:55432/commission?schema=public` in `.env`, then run setup and seed as above. Keep the database terminal running; Ctrl+C stops it without deleting data. These credentials are for local development only.

### Testing on an existing live store

Shopify CLI's `app dev --store` accepts development or Plus sandbox stores, not ordinary live stores. To verify this app on a live store, link an app registration, configure a reachable HTTPS application URL and auth callbacks, select custom distribution, and install using that app's custom installation link. The live-store deployment needs its own hosted database and secret configuration; a local database alone does not make the app remotely available.

The approved version 3 configuration requests `read_products,read_orders` and publishes paid-order/refund subscriptions. Shopify's separate access update is approved, its offline session scopes verified, and the ingestion worker is running locally. Catalog/order APIs read Shopify; settings, assignments, and commission records write only to this app's database. Keep sample assignments separate from real affiliate contracts. [Shopify custom distribution documentation](https://shopify.dev/docs/apps/launch/distribution).

## Environment variables

| Variable                   | Purpose                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`             | PostgreSQL connection URL; migrations and application persistence                  |
| `SHOPIFY_API_KEY`          | Shopify app client ID                                                              |
| `SHOPIFY_API_SECRET`       | Shopify app client secret, server only                                             |
| `SHOPIFY_APP_URL`          | Public HTTPS app URL; CLI manages dev tunnel URL                                   |
| `SHOPIFY_SHOP`             | Exact allowed `your-store.myshopify.com` domain                                    |
| `SHOP_CURRENCY`            | One allowed ISO currency, e.g. `USD`                                               |
| `SCOPES`                   | `read_products,read_orders`; matches the approved app TOML                         |
| `SUPABASE_URL`             | Managed partner email-auth project URL                                             |
| `SUPABASE_PUBLISHABLE_KEY` | Managed auth publishable key; no service-role key needed                           |
| `PORTAL_SESSION_SECRET`    | Random server-only signing secret, at least 32 characters                          |
| `PORTAL_URL`               | Optional separate HTTPS partner origin; defaults to app URL                        |
| `TEST_DATABASE_URL`        | Optional test DB URL; tests create a unique schema without resetting existing data |
| `PORT`                     | Optional production HTTP port; defaults to 3000                                    |

Do not commit `.env`, session tokens, or shop secrets. The app requests recent-order read access; it does not request `read_all_orders` or product-write scopes.

## Validation

```sh
npm test
npm run test:db
npm run lint
npm run typecheck
npm run build
```

`npm test` exercises the pure engine. `test:db` starts a disposable PostgreSQL process on localhost port 55439 when `TEST_DATABASE_URL` is absent, applies all migrations, and tests real Prisma persistence/SQL guards. It stops the process afterwards. If port 55439 is occupied, supply `TEST_DATABASE_URL` for a test database. CI uses PostgreSQL 17 and a unique test schema. Test schemas in an externally supplied database remain available for inspection; use a dedicated disposable database.

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

Organizations, affiliates, versioned programs, rate/assignment history, orders/lines, ledger/audit entries, webhook metadata, and Shopify sessions are persisted. PayPal email is private contact information; the app does not execute payouts.

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

The app was installed on Crafted with user approval and verified through a temporary HTTPS tunnel: Organizations, the live product/collection catalog, and a real collection preview load in Shopify admin. App credentials stay in Git-ignored local environment files. GraphQL operations were validated against the official 2026-10 schema. The toolkit's standalone UI validator failed due to missing React/JSX context; project TypeScript compilation verifies the installed Polaris types. The new affiliate/program screens and registration selector were also verified. Shopify order access and the local worker are active. Resend verified the sending subdomain after the approved GoDaddy DNS update. Supabase SMTP and code templates are configured, the local provider connection is active, and registration is enabled. Actual email/approval/assigned-sale/refund verification remains pending; production hosting remains deferred.

Dependency audit findings inherited from scaffold/tooling must be reviewed before a production release; compatible `npm audit fix` updates were attempted. Do not force major framework/ORM downgrades merely to suppress audit output.

## Next milestones

1. Verify real email delivery, registration, and approval with two independent affiliate accounts using the configured managed sign-in provider.
2. Verify an assigned paid sale and refund through each partner's reports using the approved Shopify access and running worker.
3. Move the app, worker, and PostgreSQL from the temporary PC/tunnel to permanent hosting before general use.
4. Review order edits, tax-inclusive normalization, historical import, and optional metafield synchronization as subsequent milestones. Payouts remain outside this scope.

The original requirements are retained in `PRD.md` and `CODEX_PROMPT.md`.
