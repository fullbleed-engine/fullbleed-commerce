CREATE TABLE "DocumentTemplate" (
  "shop" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "content" TEXT,
  "revision" TEXT NOT NULL,
  PRIMARY KEY ("shop", "kind")
);
