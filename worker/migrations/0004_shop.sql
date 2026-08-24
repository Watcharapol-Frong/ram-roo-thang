-- Coin redemption store.
--
-- Item details live in the table rather than hardcoded, because an admin page will edit them later
-- and during the beta we need to change prices or pull an item without redeploying.
CREATE TABLE IF NOT EXISTS shop_items (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  price_coins INTEGER NOT NULL,
  stock       INTEGER,                       -- NULL = unlimited stock
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- One row per redemption, linked to its coin_ledger entry through ref_id = redemptions.id.
-- status: PENDING (awaiting delivery) -> FULFILLED (delivered) | CANCELLED (coins refunded)
CREATE TABLE IF NOT EXISTS redemptions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(user_id),
  item_id      TEXT NOT NULL REFERENCES shop_items(id),
  item_name    TEXT NOT NULL,                -- name as of redemption time, in case the item is renamed later
  price_coins  INTEGER NOT NULL,             -- price as of redemption time, for the same reason
  status       TEXT NOT NULL DEFAULT 'PENDING',
  created_at   TEXT NOT NULL,
  fulfilled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_redemptions_user ON redemptions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_redemptions_status ON redemptions (status, created_at);

INSERT OR IGNORE INTO shop_items (id, name, description, price_coins, stock, active, sort_order, created_at, updated_at)
VALUES ('STICKER_LINE_01', 'สติกเกอร์ไลน์ รามรู้ทาง',
        'ชุดสติกเกอร์ประจำแอป แลกแล้วทีมงานจะส่งรหัสให้ทางแชท',
        30, NULL, 1, 1, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
