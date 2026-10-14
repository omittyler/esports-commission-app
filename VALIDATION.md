# First-pass validation — 2026-10-14

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
