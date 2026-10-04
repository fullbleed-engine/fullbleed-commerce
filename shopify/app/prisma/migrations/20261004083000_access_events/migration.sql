CREATE TABLE "AccessEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "orderId" TEXT,
    "requestId" TEXT,
    "jobId" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'started',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);
CREATE INDEX "AccessEvent_shop_startedAt_id_idx" ON "AccessEvent"("shop", "startedAt", "id");
CREATE INDEX "AccessEvent_shop_orderId_idx" ON "AccessEvent"("shop", "orderId");
CREATE INDEX "AccessEvent_shop_requestId_idx" ON "AccessEvent"("shop", "requestId");
CREATE INDEX "AccessEvent_startedAt_idx" ON "AccessEvent"("startedAt");
