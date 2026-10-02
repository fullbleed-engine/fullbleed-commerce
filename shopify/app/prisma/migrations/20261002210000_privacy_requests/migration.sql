-- CreateTable
CREATE TABLE "PrivacyRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "customerKey" TEXT,
    "emailKey" TEXT,
    "snapshot" TEXT,
    "keyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "lastExportAt" DATETIME,
    "exports" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "PrivacyRequestOrder" (
    "requestId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    PRIMARY KEY ("requestId", "orderId"),
    CONSTRAINT "PrivacyRequestOrder_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PrivacyRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PrivacyRequest_shop_status_receivedAt_idx" ON "PrivacyRequest"("shop", "status", "receivedAt");
CREATE INDEX "PrivacyRequest_shop_customerKey_idx" ON "PrivacyRequest"("shop", "customerKey");
CREATE INDEX "PrivacyRequest_shop_emailKey_idx" ON "PrivacyRequest"("shop", "emailKey");
CREATE INDEX "PrivacyRequest_finishedAt_idx" ON "PrivacyRequest"("finishedAt");
CREATE UNIQUE INDEX "PrivacyRequest_shop_requestId_key" ON "PrivacyRequest"("shop", "requestId");
CREATE INDEX "PrivacyRequestOrder_orderId_idx" ON "PrivacyRequestOrder"("orderId");
