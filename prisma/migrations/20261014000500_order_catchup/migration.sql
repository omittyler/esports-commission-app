CREATE TABLE "OrderSyncState" (
  shop text PRIMARY KEY,
  "completedThrough" timestamptz(3), "lastCompletedAt" timestamptz(3), "lastFullScanAt" timestamptz(3),
  "windowFrom" timestamptz(3), "windowTo" timestamptz(3), "creationFloor" timestamptz(3),
  cursor text, "cursorHistory" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "fullSweep" boolean NOT NULL DEFAULT false, "forceFull" boolean NOT NULL DEFAULT false,
  discovered integer NOT NULL DEFAULT 0 CHECK (discovered >= 0),
  "claimToken" uuid, "claimedAt" timestamptz(3),
  "nextScanAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastError" text,
  "coverageGapAt" timestamptz(3), "coverageGapFrom" timestamptz(3), "coverageGapTo" timestamptz(3),
  CONSTRAINT sync_window CHECK (("windowFrom" IS NULL AND "windowTo" IS NULL AND "creationFloor" IS NULL AND cursor IS NULL AND cardinality("cursorHistory")=0) OR
    ("windowFrom" IS NOT NULL AND "windowTo" IS NOT NULL AND "creationFloor" IS NOT NULL AND "windowFrom" < "windowTo" AND "creationFloor" <= "windowFrom")),
  CONSTRAINT sync_lease CHECK (("claimToken" IS NULL) = ("claimedAt" IS NULL)),
  CONSTRAINT sync_gap CHECK (("coverageGapAt" IS NULL AND "coverageGapFrom" IS NULL AND "coverageGapTo" IS NULL) OR
    ("coverageGapAt" IS NOT NULL AND "coverageGapFrom" IS NOT NULL AND "coverageGapTo" IS NOT NULL AND "coverageGapFrom" < "coverageGapTo"))
);
