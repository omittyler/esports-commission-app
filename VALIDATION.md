# First-pass validation — 2026-10-14

This first section records the original foundation check. The current affiliate portal check is recorded below.

Local checks completed with Node 24.19 and a real disposable PostgreSQL 18 instance:

```text
npm test
Test Files  2 passed (2)
Tests       20 passed (20)

npm run test:db
Test Files  1 passed (1)
Tests       12 passed (12)

npm run lint       PASS
npm run typecheck  PASS
npm run build      PASS (client and server)
Production server  HTTP 200 with migrated PostgreSQL session table
```

CI repeats the checks on PostgreSQL 17. The SQL integration tests apply both checked-in migrations and verify concurrency, idempotency, refund caps, immutability, overlap constraints, history preservation, assignment retirement, and seed reruns.

The production-server smoke check used dummy Shopify credentials and a disposable migrated database; it verifies startup and the public landing page only, not authenticated Shopify admin screens.

The Shopify AI Toolkit validated all four GraphQL catalog/collection operations against the 2026-10 Admin schema and confirmed `read_products` scope. Its standalone UI validator could not resolve the React/JSX environment; the application passes TypeScript against the installed Polaris types. The linked app configuration was subsequently validated and published by Shopify CLI.

With user approval, the app was installed on Crafted using a temporary HTTPS tunnel and the persistent local PostgreSQL database. Browser verification confirmed Organizations (Alpha 20%, Bravo 15%), live product/collection lists, and OMiT Gaming's preview with four current products. No product assignments were saved during the browser check. Collection tests additionally cover complete pagination, fetch failures, protected existing assignments, audit provenance, and concurrent/idempotent batches. No live order/refund processing is claimed.

`npm audit fix` made no compatible remediation available. The full audit reports 39 findings (35 high, 4 moderate), largely in development tooling. `npm audit --omit=dev` reports four high findings in the Prisma configuration/deepmerge dependency chain, caused by one underlying stack-exhaustion advisory. Audit recommends major ORM/adapter downgrades; these were not applied. Review and resolve this dependency chain before production deployment.

No partner authentication, payouts, ACH, Tapstitch, or cross-store functionality was built. No live order/refund webhooks were enabled.

## Affiliate portal refresh — 2026-10-14

The current build passes 36 unit tests, 18 real PostgreSQL integration tests, lint, TypeScript, and production compilation. The database suite applies all four migrations. It checks collection provenance remains scoped to the authenticated organization and covers concurrent snapshot assignments. PostgreSQL can surface the named `assignment_no_overlap` exclusion conflict before a serialization error; bounded retries now re-read current assignments while keeping the no-overlap guard intact.

The [Shopify collection lookup](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/collections) operation for current handles and the shop's primary domain validates against the 2026-10 schema with `read_products`. Link tests cover unrequested IDs, deduplication, 250-ID batches, missing/deleted collections, invalid handles/domains, and failed or partial responses. The partner financial report remains available when a storefront lookup fails.

Live browser checks confirm the redesigned dashboard and collection cards at desktop and phone widths, accurate empty states, and the assigned collections' actual Crafted storefront destinations. Managed email verification, the pending approval gate, approved dashboard/product access, and initial assignments have also been verified. A second independent Creator account and a complete live assigned-sale/refund workflow remain to verify. Paid-order/refund access and the local worker are active; payouts, ACH, Tapstitch, cross-store features, and permanent hosting remain deferred.

## Shopify admin design refresh — 2026-10-14

The embedded admin shares the partner portal stylesheet, Crafted navigation, green accents, white section cards, typography, responsive spacing, and scrollable tables. Native form controls retain input names, initial values, required/max-length constraints, disabled states, and the existing React Router actions. Authentication, App Bridge navigation, loaders, financial services, and database rules are unchanged. Catalog variants can be expanded on demand.

Lint, project TypeScript, all 36 unit tests, and the production build pass. The Shopify AI Toolkit documentation search succeeded; its standalone App Home validator could not run because the installed bundle lacks data/types/index.json (after resolving the missing TypeScript dependency in an ignored local copy). No standalone Polaris validation success is claimed; the redesigned presentation uses native React/HTML components and the existing Shopify App Bridge shell.

Authenticated Crafted browser checks confirmed all eight admin routes, organization/affiliate detail breadcrumbs, collection search narrowed to two matching collections, and the four-product collection preview. Required timestamps, organization selection, seed form defaults, and percentage/fixed-item controls retain their expected native form attributes. No approvals, commission edits, assignments, retirements, or reconciliations were submitted during these UI checks.

The 390-pixel phone viewport also passed visual inspection: admin navigation wraps, forms fit, and document scroll width equals client width (375 pixels after the scrollbar). The normal desktop viewport was restored afterward.

## Custom-domain hosting preparation — 2026-10-14

The bare portal entry point now redirects to partner login while retaining Shopify embedded launch parameters. A database-aware health endpoint returns 204/503 without private error details. The container generates Prisma before building, and the existing worker runtime is retained in production dependencies with an environment-based production command. Forty unit tests, lint, TypeScript, and app production compilation pass. Docker is unavailable on this PC, so no container execution success is claimed. Hosting selection, database migration, DNS, HTTPS, and Shopify/Supabase URL cutover remain pending; see DEPLOYMENT.md. No paid resources or DNS/configuration updates have been created.

Runtime checks on the local service confirm `/` returns 302 to `/portal/login` and `/health` returns 204 against the persistent database. The temporary HTTPS origin also visibly opens Affiliate sign-in from its bare address. These checks do not verify portal.crafted.gg; DNS has not been changed.

## Synology portability and transfer verification — 2026-10-14

45 unit tests and 18 real PostgreSQL integration tests pass locally and in GitHub CI, alongside lint, TypeScript, Prisma validation, and production compilation. The observed concurrent-assignment deadlock was an unmapped PostgreSQL 40P01 error; complete transactions now retry within the existing three-retry budget. Tests cover that case, unmapped serialization failures, permanent failures, and budget exhaustion.

The successful Linux amd64 CI release at commit 58065fbb1b12222de3edd363e5102babe52e38c0 is https://github.com/omittyler/esports-commission-app/actions/runs/38656314940 . It builds the multi-stage non-root image, starts the actual Compose app/PostgreSQL stack, validates native HTML and health, checks restricted database access, creates an exact-money fictional sale/refund with duplicate replays, rejects ledger mutation, exports/restores the database and compares all rows/schema guards, checks one-shot worker shutdown, and verifies data after restart. The source-only image and portable SHA-256 checksum are exported as a seven-day artifact. No real database or secrets are uploaded to CI.

A consistent snapshot of the existing local PostgreSQL 18 database was independently dumped using official PostgreSQL 18.6 utilities and restored into a new disposable local database. All 14 public tables and financial definitions matched exactly through the manifests. The temporary restored database was removed, and private archives/manifests remain ignored locally. The working app and worker were restarted with the verified fixes; database health returns 204.

Actual NAS hardware/runtime verification, private credential provisioning, ongoing backup scheduling, independent Creator signup, a real qualifying assigned sale/refund, missed-event reconciliation during cutover, DNS/HTTPS, and Shopify/Supabase URL activation remain required before go-live. No NAS installation or public-domain activation is claimed. See SYNOLOGY_DEPLOYMENT.md.
