# Codex Handoff Prompt

You are implementing a Shopify commission-management app for an esports apparel manufacturer.

Read `PRD.md` completely before coding.

## Objective
Build V1 of a private Shopify app that:
- ingests sales from the company’s Shopify store,
- maps products/variants to esports partner organizations,
- calculates immutable commission transactions,
- reverses commissions correctly for refunds,
- lets the company administer organizations/products/payouts,
- and later exposes an organization-scoped partner dashboard.

For the FIRST coding pass, stop after the foundation and commission engine:
1. Scaffold using Shopify’s current recommended React Router app template.
2. Use TypeScript.
3. Set up PostgreSQL and a typed ORM.
4. Implement the core schema described in PRD.md.
5. Implement Organizations and Product Assignments admin data flows.
6. Implement a standalone commission calculation domain module.
7. Add comprehensive unit tests for:
   - simple percentage commission,
   - line-item discounts,
   - mixed partner/non-partner carts,
   - mixed organizations,
   - rate snapshots,
   - partial refunds,
   - full refunds,
   - webhook/idempotency source-key behavior.
8. Do not implement Tapstitch, ACH payouts, public distribution, or cross-store functionality.
9. Do not expose customer PII to future partner-facing models unnecessarily.
10. Use integer minor units or exact decimal arithmetic for money.

## Shopify constraints
- Use GraphQL Admin API for new functionality.
- Verify current API version, fields, and webhook topics from official Shopify docs before implementing.
- Keep Shopify DTO/webhook parsing isolated from the commission domain.
- Webhook processing must be idempotent and signature-verified.

## Engineering expectations
- Clear module boundaries.
- DB constraints backing important financial invariants.
- Tests before connecting live order events.
- No microservices.
- No speculative abstractions that are not needed for V1.
- Explain security-sensitive choices.
- If a requirement is ambiguous, choose the simplest implementation consistent with the PRD and record the decision in `DECISIONS.md` instead of blocking.

## Deliverables from first pass
- running app scaffold
- DB schema + migrations
- seed data
- organization admin screens
- product-assignment foundation
- commission engine
- tests
- `.env.example`
- `README.md` with setup/run instructions
- `DECISIONS.md`
- a short list of what should be built next

Start by inspecting the repository. If it is empty, scaffold it. If it already contains a Shopify app, preserve the existing stack and adapt the plan rather than regenerating the project.
