import { describe, expect, it } from "vitest";
import {
  allocatePayment,
  paymentDate,
  paymentStatus,
} from "../../app/services/payments/domain";

describe("payment allocation and balances", () => {
  it("allocates partial payments oldest first with exact minor units", () => {
    expect(
      allocatePayment(
        [
          { id: "a", commissionMinor: 101n, allocatedMinor: 50n },
          { id: "b", commissionMinor: 99n, allocatedMinor: 0n },
        ],
        75n,
      ),
    ).toEqual([
      { transactionId: "a", amountMinor: 51n },
      { transactionId: "b", amountMinor: 24n },
    ]);
  });
  it("carries a refund on an already-paid order into the next payment", () => {
    expect(
      allocatePayment(
        [
          { id: "paid", commissionMinor: 1000n, allocatedMinor: 1000n },
          { id: "refund", commissionMinor: -500n, allocatedMinor: 0n },
          { id: "new", commissionMinor: 1000n, allocatedMinor: 0n },
        ],
        500n,
      ),
    ).toEqual([
      { transactionId: "refund", amountMinor: -500n },
      { transactionId: "new", amountMinor: 1000n },
    ]);
  });
  it("consumes each refund credit only once", () => {
    expect(
      allocatePayment(
        [
          { id: "refund", commissionMinor: -500n, allocatedMinor: -500n },
          { id: "new", commissionMinor: 1000n, allocatedMinor: 500n },
        ],
        500n,
      ),
    ).toEqual([{ transactionId: "new", amountMinor: 500n }]);
  });
  it("rejects zero, negative, and excessive payments including a negative balance", () => {
    const entries = [
      { id: "sale", commissionMinor: 1000n, allocatedMinor: 0n },
      { id: "refund", commissionMinor: -900n, allocatedMinor: 0n },
    ];
    for (const value of [0n, -1n, 101n])
      expect(() => allocatePayment(entries, value)).toThrow();
    expect(() =>
      allocatePayment(
        [{ id: "refund", commissionMinor: -1n, allocatedMinor: 0n }],
        1n,
      ),
    ).toThrow();
  });
  it("does not round large integer balances through floating point", () => {
    const amount = 9007199254740993n;
    expect(
      allocatePayment(
        [{ id: "large", commissionMinor: amount, allocatedMinor: 0n }],
        amount,
      )[0].amountMinor,
    ).toBe(amount);
  });
  it.each([
    [100n, 0n, "Unpaid"],
    [100n, 50n, "Partially paid"],
    [100n, 100n, "Paid"],
    [50n, 100n, "Refund credit"],
    [0n, 0n, "No commission due"],
  ])("labels earned %s and settled %s as %s", (earned, paid, status) => {
    expect(paymentStatus(earned, paid)).toBe(status);
  });
  it("validates actual calendar dates and rejects future payments", () => {
    const today = new Date("2026-10-14T09:00:00Z");
    expect(paymentDate("2026-10-14", today).toISOString()).toBe(
      "2026-10-14T00:00:00.000Z",
    );
    for (const input of ["2026-02-30", "2026-10-15", "10/14/2026", "invalid"])
      expect(() => paymentDate(input, today)).toThrow();
  });
});
