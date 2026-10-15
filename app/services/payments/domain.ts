export type PayableEntry = {
  id: string;
  commissionMinor: bigint;
  allocatedMinor: bigint;
};

/** Entries arrive oldest first. Apply all unused refund credits before paying
 * positive commissions; the signed allocation total equals actual money sent. */
export function allocatePayment(entries: PayableEntry[], amount: bigint) {
  const remaining = entries.map((e) => ({
    transactionId: e.id,
    amountMinor: e.commissionMinor - e.allocatedMinor,
  }));
  const available = remaining.reduce((sum, e) => sum + e.amountMinor, 0n);
  if (amount <= 0n) throw new Error("Payment must be greater than zero");
  if (amount > available)
    throw new Error("Payment exceeds outstanding commission after refunds");
  const allocations = remaining.filter((e) => e.amountMinor < 0n);
  let needed = amount - allocations.reduce((sum, e) => sum + e.amountMinor, 0n);
  for (const entry of remaining) {
    if (entry.amountMinor <= 0n || needed === 0n) continue;
    const applied = entry.amountMinor < needed ? entry.amountMinor : needed;
    allocations.push({
      transactionId: entry.transactionId,
      amountMinor: applied,
    });
    needed -= applied;
  }
  if (needed !== 0n) throw new Error("Unable to allocate payment");
  return allocations;
}

export function paymentStatus(earned: bigint, settled: bigint) {
  if (earned - settled < 0n) return "Refund credit";
  if (earned <= 0n && settled === 0n) return "No commission due";
  if (earned === settled) return "Paid";
  return settled > 0n ? "Partially paid" : "Unpaid";
}

export function paymentDate(value: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Use a payment date in YYYY-MM-DD format (UTC)");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error("Invalid payment date");
  if (value > now.toISOString().slice(0, 10))
    throw new Error("Payment date cannot be in the future");
  return date;
}
