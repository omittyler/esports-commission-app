# portal.crafted.gg deployment preparation

The custom domain is not live yet. Hosting choice and account setup are pending. The current tunnel remains active; do not change DNS or publish Shopify's production URL before the replacement service is ready.

For a portable Synology setup, container verification, and the tested transfer workflow, see [SYNOLOGY_DEPLOYMENT.md](SYNOLOGY_DEPLOYMENT.md).

## Prepared application

- Bare `/` redirects to `/portal/login`. Shopify launches with a `shop` query parameter still redirect to `/app` with their launch parameters intact.
- `/health` checks database connectivity and returns 204 or a generic 503, without database details.
- The Docker build generates Prisma before compiling and keeps `tsx` as a production dependency. Container startup applies checked-in migrations before serving.
- `npm run worker:production` uses environment variables supplied by the host; it does not require a local `.env` file. Keep the web service and worker on the same database and Shopify credentials.
- Docker execution has not been verified on this PC because Docker is unavailable. App compilation and entry-point tests are separate checks.

## Hosting choices

An always-on Render web service, background worker, and paid managed PostgreSQL are one proposed setup. Confirm current compute, storage, and usage costs in the dashboard before provisioning. No paid resource has been created.

A free testing setup can use a Render web service and Supabase PostgreSQL. Render free services sleep after 15 minutes without inbound traffic, have cold starts, and do not include a background worker. This option requires adapting worker execution and accepts delayed processing; it has not been implemented. Do not use Render's expiring 30-day free database for ongoing commission history. Supabase free projects have database/usage limits and pause after a week of inactivity. Do not enable its public Data API access to migrated private affiliate, payment-contact, session, or commission tables.

GitHub Pages serves static files and cannot run this server, private database access, Shopify authentication, webhooks, or background processing. GitHub can remain the source repository for a deployment elsewhere.

## Cutover sequence

1. Provision the chosen hosting and secure environment configuration. Supply secrets privately; never commit them. Configure `SHOPIFY_APP_URL` and `PORTAL_URL` as `https://portal.crafted.gg`, the existing single shop, currency, scopes, Supabase public configuration, and session signing secret.
2. Keep the new worker stopped while migrating. Back up the local PostgreSQL database including accounts, approvals, program/rate versions, product assignments, audits, ledger, webhook inbox, and Shopify sessions. Preserve a recoverable local copy. Never run seeds over a migrated production database.
3. Coordinate a brief write freeze: stop the local worker and pause local application writes, take a final consistent backup, restore into the hosted database, and compare row counts and exact commission totals by organization/currency. Verify database immutability and overlap constraints. Do not operate two independently writable database copies.
4. Add `portal.crafted.gg` to the chosen web host and obtain its exact DNS target. At GoDaddy, add only the `portal` subdomain record requested by the host; preserve the storefront, nameservers, mailbox, and `auth.crafted.gg` sending records. Verify DNS and HTTPS.
5. Update Supabase's Site URL for the new origin. Prepare and validate a named Shopify production configuration preserving the existing scopes/subscriptions and using the new application URL and `/auth/callback`. Publish only when the hosted app/database are ready.
6. Verify Shopify admin access, offline session access, real email-code login, partner approval gating, scoped collection/order reports, webhook delivery, and worker processing. Run a qualifying sale/refund verification with explicit merchant authorization; compare immutable financial results. Enable the hosted worker and retire the local writer/tunnel after successful checks.

References: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Render free limits](https://render.com/docs/free), [custom domains](https://render.com/docs/custom-domains), [background workers](https://render.com/docs/background-workers), [Supabase pricing](https://supabase.com/pricing).
