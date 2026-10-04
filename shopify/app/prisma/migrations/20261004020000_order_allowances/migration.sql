CREATE TABLE "UsagePeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "startsAt" DATETIME,
    "endsAt" DATETIME NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE "UsageOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reservedUntil" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "UsageOrder_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "UsagePeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UsagePeriod_shop_key_key" ON "UsagePeriod"("shop", "key");
CREATE INDEX "UsagePeriod_endsAt_idx" ON "UsagePeriod"("endsAt");
CREATE UNIQUE INDEX "UsageOrder_periodId_orderId_key" ON "UsageOrder"("periodId", "orderId");
CREATE INDEX "UsageOrder_shop_orderId_idx" ON "UsageOrder"("shop", "orderId");
