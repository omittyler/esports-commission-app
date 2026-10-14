# Affiliate portal setup and activation

## What is implemented

- Organization/Creator registration with the requested conditional fields and private PayPal contact email. Profiles are stored only after provider-verified email ownership; unverified or repeated submissions cannot replace an approved account's payment contact.
- Supabase email-code verification, signed secure sessions, provider identity checks on every request, and admin approval before partner access.
- Affiliates list/detail, approve/reject/suspend, collection provenance, program assignments, and commission orders.
- Immutable program versions: percentage or fixed amount per item. New versions do not change existing assignments or posted commissions.
- Partner products, quantities sold/refunded, net merchandise revenue, order commissions, and reversal activity. Every report uses server-verified membership and excludes other partners and customer contact data.
- Signed Shopify paid-order/refund routes, durable metadata inbox, retry leases, complete paginated reads, and reconciliation.

The local app database has all four migrations applied. The temporary app is serving these screens. Registration is disabled until the managed Supabase settings below are supplied. With merchant approval, the order configuration validated without issues and was published as `esports-commission-portal-3`. It requests `read_products,read_orders` and subscribes to paid orders/refunds. Shopify is displaying a separate permission update; that grant and the background worker are not active yet.

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

The approved command `npm run shopify -- app deploy --config orders-test --allow-updates` released app registration configuration to Shopify; it does not host the server, execute payouts, or modify store products/orders. The CLI validation returned `valid: true` with no issues. Review and approve Shopify's displayed access update separately; publishing does not complete that permission grant.

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

31 unit tests and 18 real PostgreSQL integration tests pass, along with lint, TypeScript, and the production build. Coverage includes OTP identity binding with a mocked managed provider, pending/suspended/forged session denial, report isolation, immutable program versions, exact fixed-item calculations/refunds, concurrent signup/order/refund deduplication, inbox leases, paginated ingestion, and free-item returns.

The official 2026-10 GraphQL validator accepts the order and refund operations. The standalone Polaris UI validator lacks the React/JSX/Node context required by this scaffold and reports environment errors; project compilation checks the installed Polaris types. Browser verification in Crafted covers Affiliates, Programs, registration's Organization/Creator selector, and invalid-program validation. A real applicant/email/approval/assigned-sale/refund workflow is pending the connections and permissions above.
