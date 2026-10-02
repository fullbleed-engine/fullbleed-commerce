CREATE TABLE "AutomationSettings" (
  "shop" TEXT NOT NULL PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "AutomationJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "handle" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "ttlHours" INTEGER NOT NULL,
  "retryDeadline" DATETIME NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseId" TEXT,
  "leaseUntil" DATETIME,
  "nextAttemptAt" DATETIME,
  "fingerprint" TEXT,
  "templateRevision" TEXT,
  "pdfSha256" TEXT,
  "expiresAt" DATETIME,
  "lastError" TEXT,
  "downloads" INTEGER NOT NULL DEFAULT 0,
  "lastDownloadedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AutomationJob_shop_fkey" FOREIGN KEY ("shop") REFERENCES "AutomationSettings" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AutomationJob_shop_runId_key" ON "AutomationJob"("shop", "runId");
CREATE INDEX "AutomationJob_shop_createdAt_idx" ON "AutomationJob"("shop", "createdAt");
