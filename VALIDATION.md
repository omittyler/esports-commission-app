# First-pass validation — 2026-10-14

Local checks completed with Node 24.19 and a real disposable PostgreSQL 18 instance:

```text
npm test
Test Files  1 passed (1)
Tests       15 passed (15)

npm run test:db
Test Files  1 passed (1)
Tests       9 passed (9)

npm run lint       PASS
npm run typecheck  PASS
npm run build      PASS (client and server)
```

CI repeats the checks on PostgreSQL 17. The SQL integration tests apply both checked-in migrations and verify concurrency, idempotency, refund caps, immutability, overlap constraints, history preservation, assignment retirement, and seed reruns.

The Shopify AI Toolkit validated both generated GraphQL operations against the 2026-10 Admin schema and confirmed `read_products` scope. Its standalone UI validator could not resolve the React/JSX environment; the application passes TypeScript against the installed Polaris types. CLI configuration validation stopped at the requirement to link a real app client ID. No Shopify app credentials were supplied, so installation/authenticated UI verification and live event processing are not claimed.

`npm audit fix` made no compatible remediation available. The full audit reports 39 findings (35 high, 4 moderate), largely in development tooling. `npm audit --omit=dev` reports four high findings in the Prisma configuration/deepmerge dependency chain, caused by one underlying stack-exhaustion advisory. Audit recommends major ORM/adapter downgrades; these were not applied. Review and resolve this dependency chain before production deployment.

No partner authentication, payouts, ACH, Tapstitch, or cross-store functionality was built. No live order/refund webhooks were enabled.
