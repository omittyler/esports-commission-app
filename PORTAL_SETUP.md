# Affiliate portal setup and activation

## What is implemented

- Organization/Creator registration with the requested conditional fields and private PayPal contact email. Profiles are stored only after provider-verified email ownership; unverified or repeated submissions cannot replace an approved account's payment contact.
- Supabase email-code verification, signed secure sessions, provider identity checks on every request, and admin approval before partner access.
- Affiliates list/detail, approve/reject/suspend, collection provenance, program assignments, and commission orders.
- Immutable program versions: percentage or fixed amount per item. New versions do not change existing assignments or posted commissions.
- Partner products, quantities sold/refunded, net merchandise revenue, order commissions, and reversal activity. Every report uses server-verified membership and excludes other partners and customer contact data.
- Signed Shopify paid-order/refund routes, durable metadata inbox, retry leases, complete paginated reads, and reconciliation.

The local app database has all four migrations applied. The temporary app is serving these screens. Resend has verified `auth.crafted.gg` after the approved GoDaddy DNS update. The owner saved SMTP credentials directly in Supabase, and both code email templates have been applied and checked after reload. The existing Supabase project has email sign-in/confirmation enabled and the current tunnel Site URL configured. Its publishable key is connected through the ignored local environment, the app was restarted, and registration is enabled for testing. With merchant approval, the order configuration validated without issues and was published as `esports-commission-portal-3`. Shopify's separate access update was approved; the stored offline session confirms `read_products,read_orders`. The background worker is running and processed the queued event. Initial collection assignments are configured and visible in the approved partner portal. Assigned merchandise summarizes each collection once; the product-performance table retains per-product reporting. A real assigned sale/refund remains to verify.

## Connect managed email sign-in

1. Select a Supabase project for this app. Enable email sign-in and email confirmation. Do not use an auto-confirm policy.
2. Set the site URL to the public HTTPS portal origin. It defaults to `SHOPIFY_APP_URL`; optionally use `PORTAL_URL` for a separate origin. Reconfigure it if the temporary tunnel changes.
3. Configure the sign-in and confirmation email templates to include `{{ .Token }}` so applicants receive a code to enter on `/portal/verify`. The app verifies codes through `verifyOtp({ type: "email" })` and then checks the provider's authenticated user.
   The ready-to-paste templates and dashboard settings are in [supabase/README.md](supabase/README.md).
4. Configure SMTP for real applicants. Supabase's default mail service is for limited testing and restricts recipient addresses; it is not a production mail service.
5. Put `SUPABASE_URL` and the project's **publishable key** in the server's ignored `.env`. A service-role key is not needed. `PORTAL_SESSION_SECRET` must be a random string of at least 32 characters; a local key has been generated without displaying it. Keep it out of Git.
6. Restart the server. Register a test Organization and Creator, verify their actual emails, check pending dashboard denial, approve each in Shopify admin, assign merchandise/programs, and verify their reports through separate browser sessions. Mock-provider tests passing does not verify actual email delivery.

The one-hour cookie is Secure, HttpOnly, SameSite=Lax, signed, and scoped to the portal host. Provider tokens are checked on every request; suspended/rejected accounts cannot enter reports. The app does not persist passwords or refresh tokens. After expiry, partners request a new code. Application endpoints have per-email and global limits; use provider abuse controls as well. Repeat registration cannot overwrite an existing profile or PayPal contact.

References: [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [SMTP configuration](https://supabase.com/docs/guides/auth/auth-smtp).

## Activate Shopify order ingestion

The local, Git-ignored `shopify.app.orders-test.toml` was validated and published with merchant approval for the existing Esports commission portal registration, retaining its current test URL and lifecycle callbacks. It adds only:

```toml
[access_scopes]
scopes = "read_products,read_orders"

[[webhooks.subscriptions]]
uri = "/webhooks/orders/paid"
topics = ["orders/paid"]

[[webhooks.subscriptions]]
uri = "/webhooks/refunds/create"
topics = ["refunds/create"]
```

The approved command `npm run shopify -- app deploy --config orders-test --allow-updates` released app registration configuration to Shopify; it does not host the server, execute payouts, or modify store products/orders. The CLI validation returned `valid: true` with no issues. Shopify's separate access update was subsequently approved and the offline session's scopes verified.

After authorization, set `SCOPES=read_products,read_orders` in the server environment, restart the app, and verify the stored Shopify session has order access. Run `npm run worker` in a separate terminal. Both the app and the worker need the same database and offline Shopify sessions. The worker retries failures after five minutes and recovers abandoned leases after ten minutes. Keep PostgreSQL, the app, tunnel, and worker running for local testing. Production needs an always-on web server, worker, and database.

Use **Order ingestion** to inspect deliveries or reconcile a known paid Order GID. Assignments begin prospectively: importing an order from before an assignment's effective timestamp does not retroactively create a commission. Paid orders arriving before a refund are safe; refunds arriving first reconcile the order and its refunds. Duplicate delivery IDs and duplicate financial events are independently deduplicated.

`read_orders` is limited to Shopify's recent-order access window. No `read_all_orders` is requested. Historical import, automatic order-edit adjustments, metafield sync, exports, payouts/ACH/PayPal execution, Tapstitch, and cross-store features remain outside this milestone.

## Accounting boundaries

- Percentage commission uses original merchandise minus all allocated discounts, excluding shipping/tax, in shop currency and integer minor units.
- Fixed commission is `min(amount per item × quantity, discounted merchandise revenue)`. Free items earn zero. Partial merchandise refunds reverse the original rounded commission proportionally; a full merchandise refund reverses it exactly. Quantity-only returns of free merchandise record units with zero money.
- Paid/refunded payment states only. Refund merchandise with positive value requires complete successful refund transactions. Pending/failed payments remain queued for review/retry.
- Edited orders, missing product/variant identities (including deleted catalog references or custom lines), removed quantities not explained by refunds, tax-inclusive or duty-inclusive prices, incomplete pagination, unavailable orders, currency mismatches, changed replays, and excessive refunds fail explicitly. They are not silently posted using guessed financial inputs. Existing history remains immutable.
- Suspension blocks portal access and new assignments. Retire assignments to stop future accrual; old contracts and delayed events retain their original attribution.
- Temporary test data and seeds are not production contracts. Team Alpha/Bravo are internal seed organizations, not verified affiliate accounts.

Shopify references: [LineItem quantities and discounts](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/LineItem), [Order flags](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order), [RefundLineItem](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/RefundLineItem).

## Verification

36 unit tests and 18 real PostgreSQL integration tests pass, along with lint, TypeScript, and the production build. Coverage includes OTP identity binding with a mocked managed provider, pending/suspended/forged session denial, report isolation, immutable program versions, exact fixed-item calculations/refunds, concurrent signup/order/refund deduplication, inbox leases, paginated ingestion, free-item returns, and safe collection storefront links.

The partner portal has a shared responsive Dashboard/Collections layout, currency-separated summary cards, readable empty states, and one card per assigned collection. Collection links use the assigned collection IDs, current Shopify handles, and the configured shop's primary domain. The official 2026-10 validator confirms the lookup uses existing `read_products` access. Missing collection links do not block financial reporting. Browser checks verified the actual storefront destinations and desktop/phone layouts. Concurrent assignment retries also recognize the named PostgreSQL no-overlap exclusion conflict while preserving its database guard.

The official 2026-10 GraphQL validator accepts the order and refund operations. The standalone Polaris UI validator lacks the React/JSX/Node context required by this scaffold and reports environment errors; project compilation checks the installed Polaris types. Browser verification in Crafted covers Affiliates, Programs, registration's Organization/Creator selector, and invalid-program validation. Supabase SMTP/code templates are connected and registration is enabled through the tunnel. The first real Organization applicant received and verified the email code, reached pending approval, and appeared as verified/pending in Crafted's admin; a direct dashboard request returned 403. After owner-authorized approval, its same verified session opened the partner dashboard and product report. The approved partner now sees each assigned collection once rather than repeated product rows. Database checks confirm the underlying product-wide assignments share the requested percentage program version and prospective start time. An independent Creator account and assigned-sale/refund reports remain to verify.

## Shared payment tracking

The new Commissions & payments admin page summarizes affiliate balances. An approved affiliate's detail page records transfers already sent, with amount, currency, UTC date, method and reference. Partners have a Payments page and dashboard balances showing earned, paid, outstanding and carry-forward refund credits. Payments are allocated to specific immutable commission entries, including partial settlement and refund credits. Corrections append a void record; transfers are never initiated by this app. See [PAYMENT_TRACKING.md](PAYMENT_TRACKING.md) for the accounting and correction workflow.

61 unit tests and 28 real PostgreSQL tests cover the current source, including concurrent payment/replay protection, partial/full refunds before/after payment, ingestion/payment races, corrections, database caps/immutability, partner isolation, Shopify shop authorization, request-origin checks and currency-separated affiliate totals. Initial manual payment tracking does not include monthly filters, exports or automatic catch-up.

## Portal address and matching admin design

Automatic recent-order/refund recovery now runs in the existing worker; complete scheduled daily refresh is also available. The Order reporting page separates discovery progress from unprocessed financial work, supports scan/restart/retry controls and retains older coverage-gap warnings. See [ORDER_CATCHUP.md](ORDER_CATCHUP.md) for cadence, exact recovery behavior, current Shopify access boundaries and Synology scheduling. Current verification is 80 unit plus 39 PostgreSQL tests, with a successful live refresh and an 18-table backup/restore rehearsal.

The Shopify admin uses the same Crafted visual design as the partner portal, with admin-specific navigation and forms. The portal currently remains on the temporary HTTPS tunnel. `portal.crafted.gg` has not been configured. Permanent hosting must run the app, background worker, and PostgreSQL independently of the owner's PC, then connect the subdomain and update the app, portal, authentication, and webhook URLs before retiring the tunnel.
