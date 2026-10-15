import { serializable, textField } from "../admin.server";
import { amountToMinor } from "../money";
import { allocatePayment, paymentDate } from "./domain";

export async function recordPayment(
  organizationId: string,
  form: FormData,
  actor: string,
) {
  const currency = textField(form, "currency", 3);
  if (currency !== process.env.SHOP_CURRENCY)
    throw new Error("Use the configured shop currency");
  const amountMinor = amountToMinor(textField(form, "amount", 30), currency);
  const paidAt = paymentDate(textField(form, "paidAt", 10));
  const method = textField(form, "method", 20);
  if (!["paypal", "bank", "other"].includes(method))
    throw new Error("Invalid payment method");
  const reference = textField(form, "reference", 120);
  const referenceKey = `${method}:${reference.toLowerCase()}`;
  const idempotencyKey = textField(form, "idempotencyKey", 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idempotencyKey,
    )
  )
    throw new Error("Refresh this page before recording a payment");
  if (form.get("confirmed") !== "yes")
    throw new Error("Confirm this payment was already sent outside the app");
  return serializable(async (tx) => {
    // Shared lock serializes allocations and corrections for this affiliate.
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`;
    const existing = await tx.commissionPayment.findFirst({
      where: { OR: [{ idempotencyKey }, { referenceKey }] },
      include: { void: true },
    });
    if (existing) {
      if (
        existing.void ||
        existing.organizationId !== organizationId ||
        existing.amountMinor !== amountMinor ||
        existing.currency !== currency ||
        existing.paidAt.getTime() !== paidAt.getTime() ||
        existing.method !== method ||
        existing.referenceKey !== referenceKey
      )
        throw new Error(
          "This payment reference or submission already has a different record",
        );
      return existing;
    }
    const account = await tx.affiliateAccount.findUnique({
      where: { organizationId },
    });
    if (!account || account.status !== "approved" || !account.verifiedAt)
      throw new Error("Payments require an approved, verified affiliate");
    const entries = await tx.commissionTransaction.findMany({
      where: { organizationId, currency },
      include: { paymentAllocations: { where: { payment: { void: null } } } },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    const allocations = allocatePayment(
      entries.map((e) => ({
        id: e.id,
        commissionMinor: e.commissionMinor,
        allocatedMinor: e.paymentAllocations.reduce(
          (sum, a) => sum + a.amountMinor,
          0n,
        ),
      })),
      amountMinor,
    );
    const payment = await tx.commissionPayment.create({
      data: {
        organizationId,
        amountMinor,
        currency,
        paidAt,
        method,
        reference,
        referenceKey,
        idempotencyKey,
        payeeEmail: account.paypalEmail,
        recordedBy: actor,
        allocations: { create: allocations },
      },
    });
    await tx.auditEvent.create({
      data: {
        actor,
        action: "payment.record",
        entityId: payment.id,
        metadata: {
          organizationId,
          currency,
          amountMinor: amountMinor.toString(),
          allocations: allocations.map((a) => ({
            ...a,
            amountMinor: a.amountMinor.toString(),
          })),
        },
      },
    });
    return payment;
  });
}

export async function voidPayment(
  organizationId: string,
  form: FormData,
  actor: string,
) {
  const paymentId = textField(form, "paymentId", 36);
  const reason = textField(form, "reason", 500);
  if (form.get("confirmed") !== "yes")
    throw new Error("Confirm this is a recording correction");
  return serializable(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`;
    const payment = await tx.commissionPayment.findFirst({
      where: { id: paymentId, organizationId },
      include: { void: true },
    });
    if (!payment) throw new Error("Payment not found");
    if (payment.void) return payment.void;
    const correction = await tx.paymentVoid.create({
      data: { paymentId, reason, recordedBy: actor },
    });
    await tx.auditEvent.create({
      data: {
        actor,
        action: "payment.void",
        entityId: paymentId,
        metadata: { organizationId, reason },
      },
    });
    return correction;
  });
}
