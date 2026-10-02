CREATE TABLE "Brand" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "sellerName" TEXT NOT NULL,
    "sellerLines" TEXT NOT NULL DEFAULT '',
    "accent" TEXT NOT NULL DEFAULT '#244a40',
    "footer" TEXT NOT NULL DEFAULT 'Thank you for shopping with us.',
    "paper" TEXT NOT NULL DEFAULT 'A4',
    "design" TEXT NOT NULL DEFAULT 'studio'
);
