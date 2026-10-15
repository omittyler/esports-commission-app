# Commission payment tracking

## Workflow

Shopify admin → Commissions & payments shows earned commission, recorded payments, payable affiliate balances, and refund credits separately for each currency. Credits belong to their original affiliate and never reduce another affiliate's payable balance.

Open an affiliate to record a transfer already completed through PayPal, a bank, or another method. Enter the amount, UTC calendar date, method and unique transaction reference, then confirm it has been sent. The app records payment evidence; it does not initiate or verify transfers with a payment provider.

Partners see the same balances in Dashboard and Payments, per-order paid/partially paid/unpaid status, and payment history with the commissions and refund credits covered. Payment detail preserves the affiliate's PayPal contact at recording time. Access is restricted to the verified, approved partner's own organization.

## Accounting

- Currency amounts use integer minor units. Payments cannot exceed currently outstanding net commission, including refunds. Currency balances remain separate.
- Allocations apply every unused refund credit, then consume positive commission oldest first (sale timestamp, creation timestamp, ID). A payment's signed allocations must exactly equal the money sent. Partial payments are supported.
- Example: a USD 100 commission paid in full, followed by a USD 50 reversal, produces a USD 50 carry-forward credit. A later USD 100 commission permits a USD 50 transfer, allocated as USD -50 refund credit and USD 100 new commission. The original transfer remains unchanged.
- Order-level settled amounts include credits consumed by later payments, while payment history always shows the original actual transfer amount. Negative outstanding balances are credits, not new payment obligations.
- The submitted form UUID and normalized method/reference protect replay. Reusing a reference with different financial input fails; concurrent payments cannot spend the same balance twice.
- Payments, allocations, corrections, commissions, and audit events are append-only. PostgreSQL also enforces allocation identity/currency, commission/refund limits, balanced payments and net outstanding caps; protections do not rely only on forms.
- Only verified, approved affiliates can receive newly recorded payment entries. Suspended affiliates' history remains intact. Review financial handling before using suspension to withhold an actual payment.
- Reports use a repeatable-read database snapshot so payments and balances agree during concurrent writes.

## Correcting an entry

Void recording is for an incorrectly entered record. It appends the correction and reason, excludes that entry from paid balances, and frees its allocations. Both portals retain the voided history. It does not recover or reverse transferred funds. Its original reference stays reserved; a replacement needs a distinct correction reference, such as `original-reference/correction-1`.

## Remaining milestones

Automatic missed-order/refund catch-up, monthly/date filters, exports, profile editing and approval notifications remain separate milestones. Provider-driven payouts, ACH and automatic transfer verification are not included. Real qualifying sale/refund verification and independent Creator onboarding are still required before launch.
