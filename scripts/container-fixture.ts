// Disposable CI fixture only. Never run this against a working shop database.
import assert from "node:assert/strict";
import db from "../app/db.server";
import {
  recordPayment,
  voidPayment,
} from "../app/services/payments/payments.server";
import { affiliateReport } from "../app/services/affiliates/reporting.server";
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
    const paymentForm = (
      amount: string,
      reference: string,
      idempotencyKey: string,
    ) => {
      const form = new FormData();
      Object.entries({
        amount,
        reference,
        idempotencyKey,
        currency: "USD",
        method: "paypal",
        paidAt: "2026-01-04",
        confirmed: "yes",
      }).forEach(([k, v]) => form.set(k, v));
      return form;
    };
    const mistaken = await recordPayment(
      org.id,
      paymentForm(
        "1.00",
        "CONTAINER-FICTIONAL-MISTAKE",
        "11111111-1111-4111-8111-111111111111",
      ),
      "container-test",
    );
    const correction = new FormData();
    correction.set("paymentId", mistaken.id);
    correction.set("reason", "Fictional recording correction");
    correction.set("confirmed", "yes");
    await voidPayment(org.id, correction, "container-test");
    const completed = paymentForm(
      "8.76",
      "CONTAINER-FICTIONAL-PAYMENT",
      "22222222-2222-4222-8222-222222222222",
    );
    const p = await recordPayment(org.id, completed, "container-test");
    assert.equal(
      (await recordPayment(org.id, completed, "container-test")).id,
      p.id,
    );
  }
  const rows = await db.commissionTransaction.findMany({
    orderBy: { occurredAt: "asc" },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].commissionMinor, 1753n);
  assert.equal(rows[1].commissionMinor, -877n);
  assert.equal(await db.affiliateAccount.count(), 1);
  assert.equal(await db.commissionPayment.count(), 2);
  assert.equal(await db.paymentVoid.count(), 1);
  const org = await db.organization.findUniqueOrThrow({
    where: { slug: "container-test" },
  });
  const report = await affiliateReport(org.id);
  assert.equal(report.totals[0].commission, "876");
  assert.equal(report.totals[0].paid, "876");
  assert.equal(report.totals[0].outstanding, "0");
  assert.equal(report.orders[0].paymentStatus, "Paid");
  const payment = await db.commissionPayment.findFirstOrThrow({
    where: { void: null },
  });
  await assert.rejects(
    db.commissionPayment.update({
      where: { id: payment.id },
      data: { amountMinor: 0n },
    }),
  );
  const allocation = await db.paymentAllocation.findFirstOrThrow({
    where: { paymentId: payment.id },
  });
  await assert.rejects(
    db.paymentAllocation.delete({ where: { id: allocation.id } }),
  );
  const correction = await db.paymentVoid.findFirstOrThrow();
  await assert.rejects(db.paymentVoid.delete({ where: { id: correction.id } }));
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
    "Container fixture verified: exact commission, refund, payments, correction, account, and immutable history.",
  );
} finally {
  await db.$disconnect();
}
