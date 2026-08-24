-- How many times one person may redeem an item.
--
-- The sticker is set to 1 because it is a real item with a per-unit cost; allowing repeats would let
-- one person take the whole stock. NULL means unlimited, for future items we can give away freely.
ALTER TABLE shop_items ADD COLUMN max_per_user INTEGER;

UPDATE shop_items SET max_per_user = 1, updated_at = '2026-08-24T00:00:00.000Z'
 WHERE id = 'STICKER_LINE_01';

-- What to send the student once the item is fulfilled (a sticker claim link, for example).
-- Kept on the redemption rather than the item because it is specific to that one redemption.
ALTER TABLE redemptions ADD COLUMN fulfillment_note TEXT;
