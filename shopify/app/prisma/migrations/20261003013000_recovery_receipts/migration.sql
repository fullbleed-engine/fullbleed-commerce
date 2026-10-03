CREATE TABLE "RecoveryReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RecoveryReceipt_recordedAt_idx" ON "RecoveryReceipt"("recordedAt");
