# Affiliate portal requirements

This records the user's refinements to the app foundation. Registration, approval, programs, assignments, and partner reporting are now implemented. Managed sign-in and live Shopify order access still need configuration before end-to-end use.

## Registration

Start with an **Organization / Creator** selector.

| Required field       | Organization | Creator |
| -------------------- | ------------ | ------- |
| First name           | Yes          | Yes     |
| Last name            | Yes          | Yes     |
| Email                | Yes          | Yes     |
| Organization name    | Yes          | Hidden  |
| Role at organization | Yes          | Hidden  |
| Creator name         | Hidden       | Yes     |
| PayPal email         | Yes          | Yes     |

Only relevant fields are displayed and required; the server validates the same distinction. Both types require admin approval before dashboard access. Verify identity before connecting a membership; never link an existing affiliate by a submitted name alone. Role at organization is a descriptive job title, separate from server-controlled dashboard permissions.

PayPal email is private payout contact information, accessible only to the account holder and authorized company admins. Collection of this field does not execute a payout.

## Admin

- Affiliates list includes both types, registration status, contact information, and approval actions.
- Affiliate details show its profile, assigned collections/products, programs, and commission/order history.
- Programs page supports named percentage programs or fixed dollars per item sold, such as $5 per jersey.
- Assign an approved affiliate an individual product/variant or a collection's current products, a program, and an effective date. Later collection membership changes do not rewrite the saved snapshot.
- Implementation default: each assignment selects one program; different merchandise for the same affiliate can use different programs. Preserve explicit assignments and surface collection conflicts.

## Partner

- The partner's "store" means its assigned merchandise within Crafted's Shopify catalog; this does not introduce another Shopify-store integration.
- Product breakdown: products, quantities sold, refunded quantities, qualifying merchandise revenue, and commission earned.
- Dashboard: totals and each order earning commission, with order number/date, qualifying products/quantities, commission, and reversals.
- Scope every query/export to authenticated, approved membership. Never use client-supplied affiliate IDs as authorization. Exclude other affiliates' data and unnecessary customer PII.

## Accounting and implementation

Keep integer minor units, effective dates, immutable sale-time attribution/program/rule snapshots, source-key idempotency, and reversing refunds. Percentage commissions use discounted merchandise excluding tax/shipping. Dollar programs pay per qualifying item, not per order. Define and test free/discounted merchandise and partial-quantity/amount refund treatment before activating fixed-dollar programs against live orders.

Implementation order: verified registration and approval; versioned programs and fixed-item commission tests/DB guards; affiliate detail and program assignments; signed Shopify order/refund ingestion and reconciliation; affiliate-scoped reporting.

Managed sign-in configuration and live Shopify order-access authorization are prerequisites for end-to-end use. Automated payouts, ACH, Tapstitch, and cross-store functionality remain outside this scope.
