# Esports Merchandise Commission Portal — Build Brief

## Goal
Build a private Shopify app for the apparel company’s existing Shopify store that automatically attributes merchandise sales to partner esports organizations, calculates commissions, handles refunds/adjustments, tracks payouts, and provides each organization with a secure login portal showing only its own sales and commission data.

This is Phase 1 of a larger merchandise platform. Do not build Tapstitch routing, cross-store fulfillment, ACH payouts, or multi-merchant Shopify distribution yet.

## Users

### Admin
The apparel company.
Needs full visibility across all organizations, products, orders, commissions, adjustments, and payouts.

### Partner user
A staff member belonging to one esports organization.
May view only that organization’s dashboard, product performance, commission ledger, and payout history.

One organization can have multiple partner users.

## Core workflow
1. Customer places an order on the apparel company’s Shopify store.
2. Shopify sends an order event to the app.
3. The app inspects each line item and maps the product/variant to an organization.
4. For every commissionable line item, create an immutable commission transaction using the rate that was active at the time of sale.
5. Non-partner merchandise receives no commission.
6. Mixed carts can generate commissions for multiple organizations.
7. Refunds/partial refunds create reversing commission transactions tied to the original sale.
8. Admin records payouts.
9. Partner dashboard shows sales, units, earned commission, pending balance, paid amount, product performance, and payout history.

## Version 1 scope

### Admin
- Dashboard
- Organizations CRUD
- Partner user management
- Product/variant assignment to organizations
- Percentage commissions
- Commission rule effective dates
- Shopify order ingestion
- Shopify refund/adjustment ingestion
- Commission ledger
- Manual payout recording
- CSV export
- Historical import/backfill
- Audit trail

### Partner portal
- Secure login
- Organization dashboard
- Date filters: this month, last month, YTD, all time, custom
- Gross merchandise sales for assigned products
- Order count
- Units sold
- Commission earned
- Pending commission
- Paid commission
- Product-level performance
- Commission ledger
- Payout history
- CSV export
- No access to production cost, Tapstitch, company margin, other organizations, or unnecessary fan PII

## Explicit non-goals for V1
- Tapstitch API integration
- Cross-Shopify-store product sync
- Automatic bank/ACH payouts
- Public Shopify App Store distribution
- Complex tiered commission rules
- Native mobile apps
- Partner ability to edit products
- Partner access to full customer records

## Commission rules
Initially support:
- percentage commission per organization
- commission base = qualifying merchandise revenue after line-item discounts
- exclude shipping by default
- exclude tax by default
- automatically reverse commission proportionally for refunds
- snapshot the rate and base at transaction time

Example:
Product sale after discounts: $100
Rate at sale: 20%
Commission transaction: +$20

If $50 of that line is later refunded:
Refund adjustment: -$10
Net commission: $10

Historical commission transactions must never be recalculated merely because a partner’s future rate changes.

## Product attribution
Use Shopify metafields for Shopify-side attribution, plus a canonical mapping table in the app DB.

Suggested Shopify metafield:
namespace: partner_commission
key: organization_id

The database must be authoritative enough to preserve historical attribution if products later move organizations.

Support variant-level assignment if needed. Define precedence:
1. variant assignment
2. product assignment
3. no commission

## Data model

### organizations
- id UUID PK
- name
- slug unique
- status enum(active, inactive)
- default_commission_type enum(percentage)
- default_commission_rate decimal
- created_at
- updated_at

### partner_users
- id UUID PK
- organization_id FK
- email unique
- display_name nullable
- role enum(owner, manager, viewer)
- auth_provider_subject / auth user id
- status
- created_at
- updated_at

### product_assignments
- id UUID PK
- organization_id FK
- shopify_product_gid
- shopify_variant_gid nullable
- display_title snapshot nullable
- active boolean
- effective_from
- effective_to nullable
- created_at
- updated_at

### orders
- id UUID PK
- shopify_order_gid unique
- shopify_order_name
- created_at_shopify
- currency
- financial_status
- cancelled_at nullable
- imported_at
- updated_at

### order_lines
- id UUID PK
- order_id FK
- shopify_line_item_gid unique
- shopify_product_gid nullable
- shopify_variant_gid nullable
- sku nullable
- title_snapshot
- quantity
- gross_amount
- discount_amount
- net_merchandise_amount
- currency
- organization_id_snapshot nullable
- created_at

### commission_transactions
Immutable ledger.
- id UUID PK
- organization_id FK
- order_id FK
- order_line_id FK nullable
- transaction_type enum(sale, refund, manual_adjustment)
- source_key unique for idempotency
- sale_base_amount signed decimal
- commission_rate_snapshot decimal
- commission_amount signed decimal
- currency
- source_shopify_ref nullable
- occurred_at
- notes nullable
- created_at

### payouts
- id UUID PK
- organization_id FK
- amount
- currency
- period_start
- period_end
- status enum(draft, paid, void)
- paid_at nullable
- payment_reference nullable
- notes nullable
- created_at
- updated_at

### payout_transactions
- payout_id FK
- commission_transaction_id FK
- amount_applied
Composite uniqueness to prevent double assignment.

### audit_events
- id
- actor_type
- actor_id
- action
- entity_type
- entity_id
- metadata_json
- created_at

## Financial definitions
Expose consistent definitions in UI and code.

Merchandise sales:
Sum of qualifying line merchandise revenue after discounts, excluding shipping and tax.

Commission earned:
Sum of commission ledger entries in selected period.

Pending balance:
Eligible commission ledger balance not assigned to a paid payout.

Paid:
Amount assigned to payouts with status=paid.

Refunds:
Negative commission ledger entries.

Do not derive financial history dynamically from current product prices or current commission rates.

## Shopify integration

Use the Shopify GraphQL Admin API for new development.

Initial scopes should be least-privilege and finalized during implementation. Expected need:
- read_products
- read_orders
Potentially read_all_orders if historical imports must exceed Shopify’s standard recent-order window.

Webhooks/events to evaluate:
- orders/create
- orders/updated or orders/edited as needed
- refunds/create / relevant refund topic available for selected API version
- products/update only if useful for assignment display sync
- app/uninstalled

Process webhook deliveries idempotently.
Verify Shopify webhook signatures.
Never rely on webhook delivery alone for final financial correctness; make ingestion reconcilable.

## Historical backfill
Admin should be able to run an initial import for historical orders.
Because Shopify normally limits order access to recent orders unless read_all_orders is approved, handle both:
- recent-order import
- optional all-history import if scope approved

Import must use same calculation codepath as live events where possible.
Use Shopify Bulk Operations for large history imports if warranted.

## Partner portal security
Partner portal should be separate from ordinary retail customer accounts.

Requirements:
- organization-scoped authorization on every server request
- never trust organization id from client alone
- all queries scoped using authenticated membership
- prevent insecure direct object references
- no cross-org exports
- minimal PII exposure
- audit privileged admin actions
- rate limit authentication and exports

Magic-link or modern passwordless authentication is acceptable for V1. A managed auth provider is preferred unless there is a compelling reason to own password storage.

## Screens

### Admin dashboard
Cards:
- total partner merchandise sales
- commissions accrued
- commissions pending
- commissions paid
- active organizations
- qualifying orders

Tables:
- organizations: sales, units, commission earned, pending, last payout
- recent commission activity
- payout attention items

### Organizations
List + create/edit.
Organization detail tabs:
- Overview
- Products
- Users
- Commissions
- Payouts
- Settings

Settings:
- commission percentage
- effective date
- active/inactive

### Product assignments
Search Shopify catalog.
Assign product or variant to an organization.
Bulk assignment desirable but not required for first commit.
Clearly surface conflicts.

### Commission ledger
Filters:
- organization
- date
- type
- order
- paid/unpaid

Columns:
date, organization, order, product, sale base, rate, commission, transaction type, payout status.

### Payouts
Create a draft payout from eligible transactions.
Preview included transactions.
Mark paid with date/reference.
Prevent transactions already settled in paid payouts from being paid twice.
Allow voiding only with safe accounting behavior.

### Partner dashboard
Cards:
- merchandise sales
- orders
- units
- commission earned
- pending
- paid

Charts:
- sales over time
- commission over time

Tables:
- top products
- recent qualifying orders
- recent commission activity

### Partner products
product, variant, units, sales, commission.

### Partner commissions
immutable ledger view + filters + CSV.

### Partner payouts
payout amount, covered period, paid date, reference/status.

## Privacy behavior
Partner users should not see full shipping addresses, email addresses, phone numbers, production costs, supplier names, or company margin in V1.

For order reporting, show:
- Shopify order display number
- order date
- product(s)
- quantity
- qualifying merchandise amount
- commission
- status

## Correctness requirements
- Monetary values stored as decimal/fixed precision or integer minor units, never binary floats.
- Idempotent Shopify ingestion.
- Refund calculation works for partial quantity and partial amount scenarios.
- Mixed carts correctly split by organization.
- One line can only resolve to one organization at time of sale.
- Rate changes affect only future qualifying transactions.
- Product reassignment does not rewrite past attribution.
- Payout cannot silently include the same commission twice.
- All timestamps persisted UTC; display in configured business/partner timezone.
- Keep currency on every monetary record; V1 may enforce one shop currency if preferred.

## Suggested stack
Start from Shopify’s current recommended React Router Shopify app template.
Suggested:
- TypeScript
- React Router Shopify template
- Shopify Polaris / App Bridge for embedded admin UI
- PostgreSQL
- Prisma or another well-supported typed ORM
- managed auth for partner portal
- same deployment for admin app + partner portal initially
- background job mechanism for imports/reconciliation

Do not introduce microservices in V1.

## Architecture
Shopify
  -> authenticated embedded admin app
  -> webhook endpoints
  -> ingestion service
  -> commission engine
  -> PostgreSQL
  -> admin reporting UI
  -> partner portal API/UI

The commission engine must be a standalone domain module with unit tests and should not be coupled directly to webhook route handlers.

## Suggested repository structure

app/
  routes/
    app._index.tsx
    app.organizations.*
    app.products.*
    app.commissions.*
    app.payouts.*
    portal.*
    webhooks.*
  services/
    shopify/
    commissions/
    payouts/
    reporting/
    auth/
  db/
  components/
prisma/
  schema.prisma
tests/
  commissions/
  webhooks/
  authorization/

Adapt exact paths to the generated Shopify React Router template.

## Build order

### Milestone 0 — scaffold
- generate Shopify React Router app
- configure environment
- PostgreSQL + migrations
- basic CI/lint/test
- install on development store

### Milestone 1 — organizations + assignments
- organization CRUD
- partner rate settings
- product catalog query
- product/variant assignment
- metafield sync

### Milestone 2 — order ingestion + commission engine
- order create ingestion
- normalized order/order line persistence
- organization resolution
- commission transaction creation
- idempotency
- tests for mixed carts/discounts

### Milestone 3 — refunds
- refund event ingestion
- partial/full refund calculations
- negative ledger entries
- idempotency
- tests

### Milestone 4 — admin reporting
- dashboard
- ledger
- organization detail
- CSV export

### Milestone 5 — payouts
- payout creation
- eligible-transaction selection
- paid/void lifecycle
- payout history

### Milestone 6 — partner auth + portal
- secure organization membership
- dashboard
- products
- commissions
- payouts
- strict tenant tests

### Milestone 7 — historical import + reconciliation
- backfill
- bulk operation path if necessary
- discrepancy reporting
- production readiness

## Acceptance tests
1. Team Alpha has 20% commission.
2. Customer buys $60 Alpha item and $40 generic item.
3. $10 discount applies only to Alpha item.
4. Commission base Alpha = $50; ledger = +$10.
5. Team dashboard sales increases by $50 and commission by $10.
6. Generic item creates no commission.
7. Admin later changes Alpha to 25%; historical +$10 remains unchanged.
8. New $100 Alpha sale creates +$25.
9. 50% refund of that second item creates -$12.50.
10. A Team Bravo user cannot access Alpha API routes, exports, URLs, IDs, or cached responses.
11. A payout can settle eligible transactions exactly once.
12. Re-delivering the same webhook changes no totals.

## Future phase compatibility
Design organization, assignment, order, ledger, and payout primitives so they can later support:
- merchandise displayed on partner Shopify stores
- order routing to the apparel company
- Tapstitch fulfillment hidden from partners
- company-captured payments with partner royalties/commissions
- multiple sales channels per organization
- automated payouts
- partner-controlled merchandising options

Do not implement those future features now.

## First implementation task for Codex
1. Scaffold the current Shopify React Router app template.
2. Add PostgreSQL + ORM.
3. Implement organizations, commission-rate history, product assignments, and core immutable commission ledger schema.
4. Add seed data for Team Alpha and Team Bravo.
5. Build an admin Organizations screen and Organization detail screen.
6. Write unit tests for commission calculation before wiring live Shopify order webhooks.
7. Return:
   - repo tree
   - migration/schema
   - environment variable list
   - run instructions
   - test output
   - decisions or blockers
Do not implement payouts or partner auth until the ledger tests pass.

## Important implementation instruction
Before relying on a Shopify API field/topic, verify it against the current stable Shopify Admin GraphQL API and current webhook documentation. Prefer GraphQL. Keep all Shopify-specific DTO parsing outside the commission domain module.
