# Cloudflare deployment

The current runtime is Cloudflare Workers with static assets and D1. Resend
sends verification codes directly. Supabase is not used by the application.
PostgreSQL remains only as the original database, a rollback reference, and an
independent financial regression test target. Do not delete the old database or
Supabase project until the migration and live acceptance checks are complete.

## Commands

Use Node 24 and `npm ci`, then `npm run cloudflare:generate`.

* `npm run build` generates both typed clients and builds the Worker.
* `npm run dev` runs the Cloudflare Vite development server.
* `npm start` previews the built Worker locally.
* `npm test` runs the calculation/domain tests.
* `npm run test:db` runs the isolated PostgreSQL regression suite.
* `npm run test:d1` runs the SQLite financial tests and real local D1 tests.
* `npm run typecheck` and `npm run lint` check the source.
* `npm run cloudflare:deploy` builds and deploys this Worker only.

`wrangler.jsonc` selects the Cloudflare account, D1 database, public origins and
cron. Keep credentials in encrypted Worker secrets: `SHOPIFY_API_KEY`,
`SHOPIFY_API_SECRET`, `PORTAL_SESSION_SECRET` (at least 32 random characters),
`RESEND_API_KEY`, and `DATA_MIGRATION_SHA256`. The Resend key should have sending
access restricted to `auth.crafted.gg`. No Supabase or PostgreSQL credentials
belong in the deployed Worker. Local `.dev.vars` and build output are ignored.

The Worker serves `https://crafted-commission-portal.tyler-84a.workers.dev`.
The public partner domain is configured separately using `PORTAL_URL`, with a
Worker Custom Domain route for `portal.crafted.gg`. Both configured hosts remain
usable through DNS propagation; partner mutations must match the same host's
Origin and an explicitly configured origin. Shopify admin, OAuth and webhooks keep the
registered workers.dev origin, so the portal domain does not require another
Shopify permission or callback change. Host-only cookies require signing in
again on the new public domain.
`shopify.app.cloudflare.toml` is the reviewed app configuration for this origin;
publishing a Worker does not update Shopify's app URL. Use the named config when
validating/publishing the Shopify configuration. Avoid a development command
that overwrites the production app registration's URLs.

## Financial guarantees

`cloudflare/database.server.ts` uses the generated SQLite Prisma client for
reads. It implements only the application's supported mutation shapes. Unknown
operations fail closed. A mutation first builds a plan without writing, then
submits a native atomic `D1.batch()`. Its first statement validates a global
database version; any concurrent write invalidates the entire plan and retries
with fresh reads. D1's Prisma interactive transaction implementation is never
used. Report transactions likewise retry if their database version changes.

Native SQLite triggers enforce immutable orders, lines, ledger entries, program
versions, payment records, payment allocations, payment voids and audit events.
Rate and assignment intervals cannot overlap; historical attributes cannot be
edited. Closes must be prospective and cannot exclude posted sales. The batch
guard's planning time is accepted for up to 60 seconds so retirement can commit
without backdating to an arbitrary historical time.

All calculations remain bigint minor-unit calculations. Every stored integer
must fit `[-9007199254740991, 9007199254740991]`, D1's exact JavaScript integer
range. Unsafe amounts are rejected. Aggregate reports sum individual exact
values using bigint. SQL percentage calculations split quotient/remainder, and
refund validation uses integer long multiplication/division to avoid overflowing
SQLite's 64-bit product. Partial refunds conserve the original commission.

Payments are external-transfer records only. Headers are written to an immutable
draft table, with signed allocations and an immutable seal in the same batch.
The `CommissionPayment` view exposes sealed records only. The seal checks that
allocations equal the transferred amount and do not exceed net earned commission.
Allocations cannot be added after sealing. A void appends a correction; original
records and reserved references remain intact. Paid refunds become carry-forward
credits. This application does not send money.

## Authentication

The signed, HTTP-only, Secure, SameSite=Lax cookie binds each request to a random
email challenge ID. D1 stores only an HMAC of each six-digit code. Codes expire
after 10 minutes, accept at most five attempts, and are consumed once atomically.
No raw code or access token is stored or logged. Sessions use random 256-bit
tokens stored as hashes, expire after one hour and are revoked at logout.
Every request checks the server session, email/account binding, current approval
and organization status. Existing affiliate IDs, auth subjects and approvals
are preserved; old Supabase browser sessions must sign in again. Login never
discloses whether an email has an account. Email/global request limits persist
in D1. Cross-origin mutations are rejected.

## Import and verification

1. Stop the old writer/worker and retain its database and backup. Do not run both
   ingestion workers against separate databases after cutover.
2. `npm run cloudflare:export` takes a read-only repeatable-read PostgreSQL
   snapshot into the private `backups/` folder, including Shopify sessions.
3. `node scripts/prepare-d1-import.mjs backups/d1-source-TIMESTAMP.json` validates
   the snapshot checksum, replays it through the D1 guards in an isolated SQLite
   database, and compares every persisted scalar. It writes private import SQL.
4. Apply the checked-in migration to a NEW EMPTY D1 target using Wrangler's
   migrations command. Do not edit a migration already applied to a database.
5. `node scripts/import-d1.mjs backups/d1-source-TIMESTAMP.json --local` rehearses
   the import. Use `--remote` for the selected new Cloudflare database, then
   `--verify-remote` for a separate full field comparison. Never print or commit
   the exports: they contain contacts, financial history and Shopify tokens.
6. Set `DATA_MIGRATION_SHA256` to the verified source checksum. The Worker refuses
   to serve or run scheduled jobs when the manifest is incomplete or mismatched.
   Keep the verified checksum in production. Its absence is for local development.
7. Verify email delivery, existing account access, admin pages, collection links,
   webhook rejection, catch-up progress and balances before retiring the source.

The importer preserves identifiers, historical intervals, source keys, money,
timestamps, payment references/allocations/corrections and audit records. Only
old worker leases are cleared and a full recent-order catch-up is requested.
Financial event replay follows recorded posting time; ambiguous/inconsistent
legacy histories fail validation and require review rather than dropping rows.
The import refuses a nonempty target or a repeated import. If an upload fails,
check the manifest and run verification before retrying; an active portal must
never use a partially imported target. Source writes after export require a new
reviewed snapshot, not an unverified incremental overwrite.

## Scheduled processing and free-plan limits

A cron tick runs every five minutes. Discovery runs one page per tick, starting a
full recent-order refresh daily (`ORDER_SYNC_INTERVAL_SECONDS=86400`). Each tick
processes at most one ready inbox event. The durable cursor and inbox continue on
later ticks, with leases, replay checks and visible failures. Webhooks enqueue
work immediately; reporting therefore usually follows the next available tick.
A busy backlog can take longer. One tick is intentionally bounded to avoid the
free plan's per-invocation query limit; collection lookups also split large IN
lists and writes use JSON batches. This is not an unlimited free service: monitor
CPU, query, row-read/write and storage quotas before increasing volume. No paid
plan upgrade is authorized by this configuration. A completed scan alone does
not certify financial reconciliation, and recent-order permissions cannot
recover an arbitrary all-history gap.

`portal.crafted.gg` additionally requires an active Crafted DNS zone in this
Cloudflare account. Do not change the existing site's nameservers until every
website, mailbox and Resend record has been copied and reviewed. The domain may
remain registered at GoDaddy. The workers.dev URL works independently of that
DNS change.

## Rollback

Old Synology/Docker instructions describe the pre-migration PostgreSQL/Supabase
release, not this Worker. Retain commit `342b832` and its verified source/container
artifacts for reference. Once D1 accepts new financial writes, simply pointing
back at the old PostgreSQL database would lose those writes. Freeze ingestion,
take a D1 export/backup, and reconcile every new event/payment before any rollback.
Never overwrite ledger entries, silently reseed rates, or run independent active
writers on two histories. Cloudflare deployment rollback changes code, not D1
data; schema and financial compatibility must be checked separately.

Official references: [D1 atomic batches](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[Prisma D1 limitations](https://www.prisma.io/docs/orm/v6/overview/databases/cloudflare-d1),
[React Router on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/).
