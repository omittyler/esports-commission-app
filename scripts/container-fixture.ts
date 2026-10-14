// Disposable CI fixture only. Never run this against a working shop database.
import assert from "node:assert/strict";
import db from "../app/db.server";
import {
  recordOrder,
  recordRefund,
} from "../app/services/commissions/ledger.server";

if (
  process.env.DEPLOYMENT_TEST_MODE !== "true" ||
  process.env.SHOPIFY_API_KEY !== "container-test-only" ||
  process.env.SHOPIFY_SHOP !== "example.myshopify.com"
) {
  throw new Error("Container fixture requires the isolated CI environment");
}
const verify = process.argv.includes("--verify");
try {
  if (!verify) {
    assert.equal(
      await db.organization.count(),
      0,
      "Fixture requires an empty app database",
    );
    const org = await db.organization.create({
      data: { name: "Container test team", slug: "container-test" },
    });
    await db.commissionRate.create({
      data: {
        organizationId: org.id,
        rateBps: 2000,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      },
    });
    await db.productAssignment.create({
      data: {
        organizationId: org.id,
        productGid: "gid://shopify/Product/91001",
        displayTitle: "Test jersey",
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      },
    });
    await db.affiliateAccount.create({
      data: {
        type: "organization",
        firstName: "Test",
        lastName: "Partner",
        email: "test@example.invalid",
        displayName: org.name,
        organizationRole: "Owner",
        paypalEmail: "payment@example.invalid",
        authSubject: "container-test-user",
        verifiedAt: new Date(),
        status: "approved",
        organizationId: org.id,
      },
    });
    const input = {
      orderRef: "gid://shopify/Order/91001",
      displayName: "#TEST",
      occurredAt: new Date("2026-01-02T00:00:00Z"),
      currency: "USD",
      lines: [
        {
          lineGid: "gid://shopify/LineItem/91001",
          productGid: "gid://shopify/Product/91001",
          variantGid: null,
          quantity: 2,
          grossMinor: 10000n,
          discountMinor: 1234n,
          title: "Test jersey",
        },
      ],
    };
    await recordOrder(input);
    await recordOrder(input);
    const sale = await db.commissionTransaction.findFirstOrThrow({
      where: { type: "sale" },
    });
    assert.equal(sale.commissionMinor, 1753n);
    const refund = {
      saleId: sale.id,
      refundRef: "gid://shopify/Refund/91001",
      occurredAt: new Date("2026-01-03T00:00:00Z"),
      currency: "USD",
      refundMinor: 4383n,
      refundedQuantity: 1,
    };
    await recordRefund(refund);
    await recordRefund(refund);
  }
  const rows = await db.commissionTransaction.findMany({
    orderBy: { occurredAt: "asc" },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].commissionMinor, 1753n);
  assert.equal(rows[1].commissionMinor, -877n);
  assert.equal(await db.affiliateAccount.count(), 1);
  await assert.rejects(
    db.commissionTransaction.update({
      where: { id: rows[0].id },
      data: { commissionMinor: 0n },
    }),
  );
  const role = await db.$queryRaw<
    { privileged: boolean }[]
  >`SELECT rolsuper OR rolcreatedb OR rolcreaterole AS privileged FROM pg_roles WHERE rolname=current_user`;
  assert.equal(
    role[0].privileged,
    false,
    "Runtime database role must be restricted",
  );
  console.log(
    "Container fixture verified: exact commission, idempotent refund, account, and immutable ledger.",
  );
} finally {
  await db.$disconnect();
}
