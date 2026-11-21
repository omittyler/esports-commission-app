# Esports merchandise commission portal

Crafted's Shopify admin and affiliate portal, built with React Router, Cloudflare
Workers, D1 and typed Prisma models. Email-code sign-in uses Resend directly.
Supabase is not required.

The portal supports Organization/Creator registration, email verification and
admin approval; affiliate lists/details; percentage and fixed-dollar-per-item
commission programs; product/variant or current-collection snapshot assignments;
collection links and scoped partner sales/order dashboards; an immutable
sale/refund ledger; and manual payment recording with shared paid/outstanding
balances, refund credits and audited corrections. Money is represented using
integer minor units. Programs and rates retain their historical versions.

Tapstitch, automatic transfers, ACH and cross-store features remain deferred.

## Development

Use Node 24 and npm. See [Cloudflare deployment](CLOUDFLARE_DEPLOYMENT.md) for
credentials, data migration, schedules, limits and rollback requirements.

```sh
npm ci
npm run setup
npm run cloudflare:seed
npm run dev
```

Create an ignored local `.dev.vars` file with the Worker secrets described in
the deployment guide. PostgreSQL is needed only to export the original database
or run the independent PostgreSQL financial regression suite. Team Alpha/Bravo
fixtures seed locally without replacing existing rates.

```sh
npm run lint
npm run typecheck
npm test
npm run test:db
npm run test:d1
npm run build
```

The D1 suite tests atomic rollback, concurrent replay protection, refund
conservation, payment credits/seals/corrections, immutable history, fixed-dollar
rules, large collection/query batches, exact large amounts and native email-code
sessions against SQLite and Cloudflare's local D1 runtime. CI also preserves the
PostgreSQL behavior checks. No real emails or financial transfers occur in tests.

## Deployment

`npm run cloudflare:deploy` publishes only the configured Crafted Worker. The
Shopify URL cutover uses `shopify.app.cloudflare.toml` for the existing app and
keeps the same scopes and webhook topics. The local `shopify.app.toml` tunnel
configuration is separate and must not overwrite the production URLs.

The public address is [Crafted affiliate portal](https://portal.crafted.gg/portal/login).
The [workers.dev fallback](https://crafted-commission-portal.tyler-84a.workers.dev/portal/login)
remains usable while DNS propagates. The custom-domain route is configured;
verify Cloudflare zone activation and HTTPS before announcing the public address.
The existing website/mail records remain DNS-only and keep their original targets.

The original PostgreSQL database and pre-migration release remain available as
references. Synology/Docker documents describe that older release; they are not
the deployment target of this source. Do not delete Supabase or the source
database until all live acceptance checks and reconciliation are complete.

Additional context: [requirements](AFFILIATE_PORTAL_REQUIREMENTS.md),
[payment tracking](PAYMENT_TRACKING.md), [catch-up behavior](ORDER_CATCHUP.md).
