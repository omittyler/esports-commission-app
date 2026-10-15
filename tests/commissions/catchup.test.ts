import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  SAFE_LOOKBACK_MS,
  SYNC_LAG_MS,
  scanWindow,
  syncIntervalMs,
  validateDiscoveryPage,
  orderSearch,
} from "../../app/services/shopify/catchup";
const now = new Date("2026-10-14T12:00:00Z");
const window = scanWindow(now, null, null, false);
const node = {
  id: "gid://shopify/Order/100",
  createdAt: "2026-10-13T10:00:00Z",
  updatedAt: "2026-10-14T10:00:00Z",
  displayFinancialStatus: "PAID",
};
describe("bounded order catch-up", () => {
  it("starts with a full recent-order sweep and leaves a lag buffer", () => {
    expect(window.fullSweep).toBe(true);
    expect(now.getTime() - window.creationFloor.getTime()).toBe(
      SAFE_LOOKBACK_MS,
    );
    expect(now.getTime() - window.windowTo.getTime()).toBe(SYNC_LAG_MS);
  });
  it("overlaps incremental discovery by one day and repeats full coverage daily", () => {
    const previous = new Date(now.getTime() - 3600000);
    const partial = scanWindow(now, previous, previous, false);
    expect(partial.fullSweep).toBe(false);
    expect(partial.windowFrom.getTime()).toBe(previous.getTime() - DAY_MS);
    expect(
      scanWindow(now, previous, new Date(now.getTime() - DAY_MS), false)
        .fullSweep,
    ).toBe(true);
    expect(scanWindow(now, previous, previous, true).windowFrom).toEqual(
      window.creationFloor,
    );
  });
  it("flags the uncovered interval after long downtime rather than certifying it", () => {
    const previous = new Date(now.getTime() - 90 * DAY_MS);
    expect(scanWindow(now, previous, previous, false).gap).toEqual({
      from: previous,
      to: window.creationFloor,
    });
    expect(() =>
      scanWindow(now, new Date(now.getTime() + 1), null, false),
    ).toThrow("future");
  });
  it("supports hourly/default and daily cadence and rejects invalid schedules", () => {
    expect(syncIntervalMs("")).toBe(3600000);
    expect(syncIntervalMs("86400")).toBe(DAY_MS);
    for (const value of ["299", "86401", "-1", "3.5", "invalid"])
      expect(() => syncIntervalMs(value)).toThrow();
  });
  it("bounds both creation and update dates when searching finalized orders", () => {
    const search = orderSearch(window);
    expect(search).toContain(
      `created_at:>='${window.creationFloor.toISOString()}'`,
    );
    expect(search).toContain(`updated_at:<'${window.windowTo.toISOString()}'`);
    expect(search).toContain("financial_status:refunded");
  });
  it("accepts a valid page and refuses cursor loops or truncated pagination", () => {
    const page = {
      nodes: [node],
      pageInfo: { hasNextPage: true, endCursor: "next" },
    };
    expect(validateDiscoveryPage(page, { ...window, cursorHistory: [] })).toBe(
      "next",
    );
    expect(() =>
      validateDiscoveryPage(page, { ...window, cursorHistory: ["next"] }),
    ).toThrow("cursor");
    expect(() =>
      validateDiscoveryPage(
        { ...page, nodes: [] },
        { ...window, cursorHistory: [] },
      ),
    ).toThrow();
    expect(() =>
      validateDiscoveryPage(
        { ...page, pageInfo: { hasNextPage: true, endCursor: null } },
        { ...window, cursorHistory: [] },
      ),
    ).toThrow();
  });
  it.each([
    { ...node, id: "invalid" },
    { ...node, createdAt: "2025-01-01T00:00:00Z" },
    { ...node, updatedAt: now.toISOString() },
    { ...node, displayFinancialStatus: "PENDING" },
    { ...node, updatedAt: "invalid" },
  ])("rejects an out-of-window, nonfinal or malformed order: %j", (invalid) => {
    expect(() =>
      validateDiscoveryPage(
        { nodes: [invalid], pageInfo: { hasNextPage: false, endCursor: null } },
        { ...window, cursorHistory: [] },
      ),
    ).toThrow();
  });
  it("rejects duplicate nodes and oversized pages before checkpointing", () => {
    for (const nodes of [[node, node], Array.from({ length: 101 }, () => node)])
      expect(() =>
        validateDiscoveryPage(
          { nodes, pageInfo: { hasNextPage: false, endCursor: null } },
          { ...window, cursorHistory: [] },
        ),
      ).toThrow();
  });
});
