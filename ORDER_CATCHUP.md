# Automatic order and refund catch-up

## Running it

The continuous commission worker now discovers missing work automatically while continuing to process signed webhooks. It scans hourly by default, overlaps incremental update windows by one day, and repeats a complete recent-order sweep daily. Set `ORDER_SYNC_INTERVAL_SECONDS=86400` for daily discovery cadence, or a whole number from 300 through 86400 for another interval. `ORDER_SYNC_ENABLED=false` disables automatic discovery in the continuous worker without disabling webhook processing.

A full scheduled run is available separately:

```sh
npm run refresh:orders
# Production environments receive credentials through their existing environment:
npm run refresh:orders:production
```

The scheduled command requests a full sweep, resumes saved pages, completes any pending full-sweep request, and drains all ready reconciliation batches. It returns a nonzero exit code for incomplete discovery, interruption, deferred failures or outstanding work. Its default run budget is 25 minutes. Unfinished pages and deliveries remain durable for the next execution. A competing active discovery lease reports incomplete instead of claiming another worker's result.

`worker --once` retains its earlier contract: one inbox batch only. It is not the complete daily refresh command.

## Recovery and financial accuracy

- The discovery query requests only order ID, creation/update timestamps and financial status. Customer names, email, addresses and payment details are not fetched or stored by discovery.
- A fixed scan window, saved cursor and cursor history support crash recovery. Every page is validated before its discovered IDs and progress commit together in a serializable transaction.
- A ten-minute renewable lease coordinates competing workers. Expired/replaced leases cannot enqueue stale pages or advance checkpoints. Cursor loops, incomplete pages, out-of-window results, API errors and query warnings fail without advancing the page.
- Five minutes of lag reduce races with fresh updates. Daily full sweeps requeue older successful synthetic deliveries for rechecking even if `updatedAt` is unchanged. The same inbox row is reused; immediate replay does not duplicate reconciliation work.
- A completed discovery scan means accessible qualifying order IDs were queued, not that every financial entry has posted. Existing financial reconciliation reads all lines and refunds, preserves sale-time rules and attribution, applies exact proportional refund reversals, and deduplicates financial events independently of discovery IDs.
- Unsupported edited/tax-inclusive/duty-inclusive/changed orders and incomplete refunds remain failed/retryable deliveries. Other queued orders continue even when an entire batch fails. Original commission and payment history is not edited.
- A full rescan never adds retroactive commissions to orders whose original sale preceded its assignment or contract.

## Current access boundary

Catch-up uses a 59-day creation window within Shopify's default recent-order access, with both creation and updated-at bounds. It does not request broader scopes or historical access. Orders older than this safety window may have newer refunds that cannot be discovered by this bounded scan. Long downtime records and retains a coverage-gap warning; a new recent scan does not certify that earlier interval. An abandoned window that has aged outside access is restarted and marked for coverage review.

Older missing history or refunds require separately reviewed access and reconciliation. This feature is not an all-history import or a guarantee against deletions, unavailable catalog identity, unsupported financial edits, or prolonged outages.

Official references: [orders filtering and pagination](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/orders), [order access permissions](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order).

## Admin controls

Shopify admin → Order reporting shows last discovery completion, its cutoff, saved scan progress, pending/failed reconciliation counts and persistent coverage warnings. Request recent-order scan queues/resumes discovery. Restart recent-order scan invalidates stale discovery work and rediscovers accessible history without editing the ledger. Retry failed deliveries makes unprocessed failures without a live lease ready again, while retaining financial safeguards. The worker must run to perform requested scans; the daily command can perform an explicitly scheduled refresh independently.

Only the configured authenticated Shopify shop with approved order access can use these actions, and POST requests must originate from the app's configured origin. Paused/suspended partner accounts do not gain access through recovery work.

## Synology daily operation

Keep the app and database running so partners can sign in and Shopify can queue incoming deliveries. For once-daily processing, do not run the continuous worker; use DSM Task Scheduler to execute the complete command once a day:

```sh
cd /volume1/docker/esports-commission-app
docker compose --env-file .env.synology -f compose.synology.yaml --profile processing run --rm --no-deps worker node --import tsx scripts/refresh-orders.ts
```

Use the real private project directory and credentials already configured on the NAS. Avoid overlapping scheduled jobs. Check the exit code and Order reporting for failures. Scheduling on actual NAS hardware has not been configured yet.
