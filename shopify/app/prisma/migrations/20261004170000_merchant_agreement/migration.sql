CREATE TABLE "AgreementAcceptance" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "version" TEXT NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "acceptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
