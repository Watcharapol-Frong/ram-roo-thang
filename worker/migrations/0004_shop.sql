-- ร้านค้าแลกเหรียญ
--
-- รายละเอียดสินค้าอยู่ในตาราง ไม่ฮาร์ดโค้ดในโค้ด เพราะหน้าแอดมินจะมาแก้ทีหลัง
-- และช่วง beta ต้องปรับราคา/ปิดขายได้โดยไม่ต้อง deploy ใหม่
CREATE TABLE IF NOT EXISTS shop_items (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  price_coins INTEGER NOT NULL,
  stock       INTEGER,                       -- NULL = ไม่จำกัดจำนวน
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- การแลกแต่ละครั้ง — ผูกกับแถวใน coin_ledger ผ่าน ref_id = redemptions.id
-- status: PENDING (รอส่งของ) -> FULFILLED (ส่งแล้ว) | CANCELLED (คืนเหรียญแล้ว)
CREATE TABLE IF NOT EXISTS redemptions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(user_id),
  item_id      TEXT NOT NULL REFERENCES shop_items(id),
  item_name    TEXT NOT NULL,                -- เก็บชื่อ ณ เวลาที่แลก เผื่อสินค้าถูกแก้ชื่อทีหลัง
  price_coins  INTEGER NOT NULL,             -- เก็บราคา ณ เวลาที่แลกด้วยเหตุผลเดียวกัน
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
