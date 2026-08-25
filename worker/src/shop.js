// GET /api/shops — ร้านค้า/ซุ้มในแคมปัส สำหรับแท็บ "ร้านค้า/ซุ้ม" ใน LIFF
// ข้อมูลนิ่ง ไม่มีสถานะเปลี่ยนตามเวลาเหมือนลานจอด จึงคืนรายการตรงๆ ไม่ต้อง resolve อะไรเพิ่ม

import { listShops } from './data.js';
import { ensureUser, getUserRow } from './user.js';
import { pushToLINE } from './line.js';
import { requireAdmin } from './shared.js';

export async function handleListShops(request, env) {
  const shops = await listShops(env);
  return new Response(JSON.stringify({ shops }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// --- ร้านค้าแลกเหรียญ (ตาราง shop_items / redemptions ใน D1) ---
//
// แยกจาก handleListShops ข้างบนที่เป็น "ร้านค้า/ซุ้มในมหาวิทยาลัย" บนแผนที่ คนละเรื่องกัน

function shopJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/shop/items — รายการที่แลกได้ พร้อมยอดเหรียญของผู้ใช้ถ้าส่ง user_id มา
export async function handleListShopItems(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');

  const { results } = await env.DB.prepare(
    `SELECT id, name, description, price_coins, stock, max_per_user FROM shop_items
      WHERE active = 1 ORDER BY sort_order, name`
  ).all();

  // นับว่าผู้ใช้เคยแลกอะไรไปแล้วกี่ครั้ง เพื่อบอกล่วงหน้าว่าปุ่มไหนกดไม่ได้แล้ว
  // ไม่นับรายการที่ยกเลิกไป เพราะคืนเหรียญให้แล้ว ต้องแลกใหม่ได้
  let ownedCount = {};
  if (userId) {
    const owned = await env.DB.prepare(
      `SELECT item_id, COUNT(*) AS n FROM redemptions
        WHERE user_id = ? AND status != 'CANCELLED' GROUP BY item_id`
    ).bind(userId).all();
    for (const r of owned.results || []) ownedCount[r.item_id] = r.n;
  }

  let coins = null;
  if (userId) {
    await ensureUser(env, userId);
    const user = await getUserRow(env, userId);
    coins = user ? user.coins : 0;
  }

  return shopJson({
    coins,
    items: (results || []).map((item) => {
      const owned = ownedCount[item.id] || 0;
      return {
        ...item,
        owned,
        // stock = null คือไม่จำกัด ต้องแยกจาก 0 ที่แปลว่าหมดจริง
        sold_out: item.stock !== null && item.stock <= 0,
        limit_reached: item.max_per_user !== null && owned >= item.max_per_user,
        affordable: coins === null ? null : coins >= item.price_coins,
      };
    }),
  });
}

// POST /api/shop/redeem — หักเหรียญแล้วสร้างรายการแลก
//
// ลำดับสำคัญ: หักเหรียญด้วย UPDATE แบบมีเงื่อนไข `coins >= ราคา` ก่อนเสมอ
// เพราะ SQLite ทำ UPDATE นี้แบบ atomic — กดปุ่มรัวๆ หรือยิงพร้อมกันสองที ตัวที่สองจะได้
// changes = 0 แล้วถูกปฏิเสธ ถ้าไปอ่านยอดมาเทียบใน JS ก่อนค่อยหัก จะแลกเกินเหรียญที่มีได้
//
// ถ้าขั้นบันทึกหลังจากนั้นพัง จะคืนเหรียญให้แล้ว log ไว้ — ยอมให้มีช่วงสั้นๆ ที่เหรียญถูกหัก
// ไปแล้วแต่ยังไม่มีรายการ ดีกว่าปล่อยให้แลกเกินยอดซึ่งแก้ทีหลังไม่ได้
export async function handleRedeemItem(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return shopJson({ error: 'Invalid JSON body' }, 400);
  }

  const { user_id: userId, item_id: itemId } = payload;
  if (!userId || !itemId) return shopJson({ error: 'ต้องระบุ user_id และ item_id' }, 400);

  const item = await env.DB.prepare(
    'SELECT id, name, price_coins, stock, max_per_user FROM shop_items WHERE id = ? AND active = 1'
  ).bind(itemId).first();
  if (!item) return shopJson({ error: 'ไม่พบสินค้านี้' }, 404);
  if (item.stock !== null && item.stock <= 0) {
    return shopJson({ status: 'OUT_OF_STOCK', error: 'สินค้าหมดแล้ว' }, 409);
  }

  await ensureUser(env, userId);

  // โควตาต่อคน — เช็คก่อนหักเหรียญ ไม่งั้นหักไปแล้วค่อยพบว่าแลกไม่ได้ ต้องมาคืนทีหลัง
  if (item.max_per_user !== null) {
    const used = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM redemptions WHERE user_id = ? AND item_id = ? AND status != 'CANCELLED'`
    ).bind(userId, item.id).first();
    if (used && used.n >= item.max_per_user) {
      return shopJson({
        status: 'LIMIT_REACHED',
        error: item.max_per_user === 1 ? 'ของชิ้นนี้แลกได้คนละ 1 ครั้งเท่านั้น' : `แลกได้ไม่เกิน ${item.max_per_user} ครั้งต่อคน`,
      }, 409);
    }
  }

  const deducted = await env.DB.prepare(
    'UPDATE users SET coins = coins - ?, updated_at = ? WHERE user_id = ? AND coins >= ?'
  ).bind(item.price_coins, new Date().toISOString(), userId, item.price_coins).run();

  if (!deducted.meta || deducted.meta.changes === 0) {
    const user = await getUserRow(env, userId);
    return shopJson({
      status: 'INSUFFICIENT_COINS',
      error: 'เหรียญไม่พอ',
      coins: user ? user.coins : 0,
      price_coins: item.price_coins,
    }, 409);
  }

  const redemptionId = crypto.randomUUID();
  const at = new Date().toISOString();
  const user = await getUserRow(env, userId);

  try {
    const statements = [
      env.DB.prepare(
        `INSERT INTO redemptions (id, user_id, item_id, item_name, price_coins, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`
      ).bind(redemptionId, userId, item.id, item.name, item.price_coins, at),
      env.DB.prepare(
        `INSERT INTO coin_ledger (user_id, delta, reason, ref_id, balance_after, created_at)
         VALUES (?, ?, 'SHOP_REDEEM', ?, ?, ?)`
      ).bind(userId, -item.price_coins, redemptionId, user.coins, at),
    ];
    if (item.stock !== null) {
      statements.push(env.DB.prepare('UPDATE shop_items SET stock = stock - 1, updated_at = ? WHERE id = ?')
        .bind(at, item.id));
    }
    await env.DB.batch(statements);
  } catch (err) {
    console.error('บันทึกการแลกไม่สำเร็จ คืนเหรียญให้ผู้ใช้', userId, err);
    await env.DB.prepare('UPDATE users SET coins = coins + ?, updated_at = ? WHERE user_id = ?')
      .bind(item.price_coins, new Date().toISOString(), userId).run()
      .catch((e) => console.error('คืนเหรียญไม่สำเร็จ ต้องตามแก้มือ', userId, e));
    return shopJson({ error: 'แลกไม่สำเร็จ กรุณาลองใหม่' }, 500);
  }

  return shopJson({
    status: 'SUCCESS',
    redemption: { id: redemptionId, item_name: item.name, price_coins: item.price_coins, status: 'PENDING' },
    coins: user.coins,
  });
}

// GET /api/shop/redemptions?user_id= — ประวัติการแลกของผู้ใช้
export async function handleListRedemptions(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  if (!userId) return shopJson({ error: 'ต้องระบุ user_id' }, 400);

  const { results } = await env.DB.prepare(
    `SELECT id, item_name, price_coins, status, created_at, fulfilled_at
       FROM redemptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(userId).all();

  return shopJson({ redemptions: results || [] });
}

// --- ฝั่งแอดมิน: จัดของแล้วแจ้งผู้ใช้ ---
//
// แยกออกมาเป็น endpoint เพราะการส่งของจริง (สติกเกอร์) ทำอัตโนมัติผ่าน Messaging API ไม่ได้
// API ส่งได้เฉพาะสติกเกอร์ชุดทางการของ LINE เท่านั้น ส่วนการ "มอบ" ชุดสติกเกอร์ให้ผู้ใช้เป็น
// เจ้าของต้องใช้ Mission Sticker API ซึ่งเปิดให้เฉพาะลูกค้าองค์กรที่ทำสัญญากับ LINE
// ระบบจึงออกแบบให้คนกดยืนยันการส่ง แล้วบอทเป็นคนแจ้งผู้ใช้ให้ — พอได้สิทธิ์ Mission Sticker
// เมื่อไร เปลี่ยนเฉพาะขั้นตอนภายในฟังก์ชันนี้ ส่วนที่ผู้ใช้เห็นไม่ต้องแก้เลย

// GET /api/admin/redemptions?status=PENDING — คิวของที่ต้องส่ง
export async function handleAdminListRedemptions(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'PENDING';
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, item_name, price_coins, status, created_at, fulfilled_at
       FROM redemptions WHERE status = ? ORDER BY created_at LIMIT 200`
  ).bind(status).all();

  return shopJson({ status, count: (results || []).length, redemptions: results || [] });
}

// POST /api/admin/redemptions/fulfill — ทำเครื่องหมายว่าส่งแล้ว + push แจ้งผู้ใช้
//   body: { redemption_id, note }   note = ข้อความ/ลิงก์รับของที่จะส่งให้ผู้ใช้
export async function handleAdminFulfill(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return shopJson({ error: 'Invalid JSON body' }, 400);
  }

  const { redemption_id: id, note } = payload;
  if (!id) return shopJson({ error: 'ต้องระบุ redemption_id' }, 400);

  const redemption = await env.DB.prepare(
    'SELECT id, user_id, item_name, status FROM redemptions WHERE id = ?'
  ).bind(id).first();
  if (!redemption) return shopJson({ error: 'ไม่พบรายการแลกนี้' }, 404);
  if (redemption.status === 'FULFILLED') {
    return shopJson({ status: 'ALREADY_FULFILLED' });
  }

  const at = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE redemptions SET status = 'FULFILLED', fulfilled_at = ?, fulfillment_note = ? WHERE id = ?"
  ).bind(at, note || null, id).run();

  // แจ้งผู้ใช้ — ถ้า push พังไม่ต้อง rollback สถานะ เพราะของส่งไปแล้วจริง
  // แอดมินตามแจ้งเองได้ แต่ห้ามให้รายการกลับไปเป็น PENDING แล้วโดนส่งซ้ำ
  let notified = false;
  try {
    const lines = [
      `ของรางวัลของคุณพร้อมแล้วครับ`,
      '',
      redemption.item_name,
      ...(note ? ['', note] : []),
    ];
    await pushToLINE(redemption.user_id, [{ type: 'text', text: lines.join('\n') }], env.LINE_CHANNEL_ACCESS_TOKEN);
    notified = true;
  } catch (err) {
    console.error('แจ้งผู้ใช้เรื่องของรางวัลไม่สำเร็จ', redemption.user_id, err);
  }

  return shopJson({ status: 'SUCCESS', notified, redemption_id: id });
}
