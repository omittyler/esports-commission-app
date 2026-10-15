import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import db from "../../app/db.server";
import { serializable } from "../../app/services/admin.server";

vi.mock("../../app/db.server", () => ({ default: { $transaction: vi.fn() } }));
const transaction = vi.mocked(db.$transaction);
function unknown(message: string) {
  return new Prisma.PrismaClientUnknownRequestError(message, {
    clientVersion: "test",
  });
}
beforeEach(() => {
  transaction.mockReset();
});
describe("bounded transaction retries", () => {
  it.each(["40001", "40P01"])(
    "retries raw-query PostgreSQL %s wrapped as P2010",
    async (code) => {
      transaction
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError("Raw query failed", {
            code: "P2010",
            clientVersion: "test",
            meta: { code },
          }),
        )
        .mockResolvedValueOnce("saved");
      expect(await serializable(async () => "saved")).toBe("saved");
      expect(transaction).toHaveBeenCalledTimes(2);
    },
  );
  it("does not retry raw-query financial constraint failures", async () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      "Financial guard failed",
      { code: "P2010", clientVersion: "test", meta: { code: "23514" } },
    );
    transaction.mockRejectedValue(error);
    await expect(serializable(async () => "saved")).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it.each(["40P01", "40001"])(
    "retries PostgreSQL %s when Prisma leaves it unmapped",
    async (code) => {
      transaction
        .mockRejectedValueOnce(unknown(`PostgresError { code: "${code}" }`))
        .mockResolvedValueOnce("saved");
      expect(await serializable(async () => "saved")).toBe("saved");
      expect(transaction).toHaveBeenCalledTimes(2);
    },
  );
  it("retries only the recognized assignment exclusion conflict", async () => {
    transaction
      .mockRejectedValueOnce(
        unknown('code: "23P01", constraint: "assignment_no_overlap"'),
      )
      .mockResolvedValueOnce("saved");
    expect(await serializable(async () => "saved")).toBe("saved");
  });
  it("does not swallow permanent database failures", async () => {
    const error = unknown('code: "23514", check constraint failed');
    transaction.mockRejectedValue(error);
    await expect(serializable(async () => "saved")).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it("stops after the existing retry budget is exhausted", async () => {
    const error = unknown('code: "40P01", deadlock detected');
    transaction.mockRejectedValue(error);
    await expect(serializable(async () => "saved")).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(4);
  });
});
