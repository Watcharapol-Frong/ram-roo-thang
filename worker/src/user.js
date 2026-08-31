import { jsonResponse, bangkokDate } from './shared.js';

// ผู้ใช้ + บัญชีเหรียญ บน D1 (ดู worker/migrations/0001_users_and_coin_ledger.sql)
//
// ย้ายมาจาก USER_PROFILES KV ด้วยเหตุผลสามข้อ:
//   1. KV ไม่มี atomic increment — บวก/หักเหรียญคือ read-modify-write ยอดหายได้ถ้ายิงพร้อมกัน
//      พอมี shop ที่ต้องหักเหรียญ เรื่องนี้กลายเป็นของจริงที่ผู้ใช้เสียประโยชน์ ไม่ใช่เคสทฤษฎี
//   2. ledger ต้อง query ได้ (เรียงเวลา/กรองตามคน/รวมยอด) ซึ่ง KV ทำไม่ได้เลย
//   3. โควตาเขียนของ KV free tier คือ 1,000 แถว/วัน ส่วน D1 คือ 100,000 แถว/วัน
//
// หลักการ: coin_ledger คือความจริง ส่วน users.coins เป็นยอดสรุปที่คำนวณไว้ล่วงหน้า
// ทั้งสองอย่างเขียนใน batch เดียวกันเสมอ ถ้าไม่ตรงกันเมื่อไรให้เชื่อ ledger (ดู recalculateBalance)
//
// ไม่เก็บ PII — มีแค่ LINE userId เหมือนส่วนอื่นของระบบ (CONTEXT.md "PII")

// จำนวนเหรียญของแต่ละการกระทำ — แก้ที่นี่ที่เดียว
//
// รายงานที่จอดแบ่งเป็นสองก้อน เพราะเดิมจ่ายเต็มทุกครั้งที่กด ซึ่งให้รางวัลกับ "จำนวนครั้งที่กด"
// ไม่ใช่ "ความตรงกับของจริง" คนที่รีบจึงกดปุ่มไหนก็ได้แล้วได้เท่ากับคนที่ดูจริง
//   PARKING_REPORT            จ่ายทันทีที่รายงาน
//   PARKING_REPORT_CONFIRMED  จ่ายย้อนหลังให้เจ้าของรายงาน เมื่อมีคนอื่นมาเห็นตรงกันโดยอิสระ
// ตั้งให้เท่ากัน รายงานที่มีคนยืนยันจึงได้ 2 เท่าของการกดมั่ว
//
// ตั้งใจไม่หักเหรียญเมื่อรายงานไม่ตรงกับคนถัดไป เพราะสภาพลานเปลี่ยนได้จริงในครึ่งชั่วโมง
// การหักจะกลายเป็นลงโทษคนที่รายงาน "การเปลี่ยนแปลง" ซึ่งเป็นข้อมูลที่มีค่าที่สุด
//
// ทำไมถึงเป็น 2 ไม่ใช่เลขใหญ่กว่านี้: ของในร้านมีชิ้นเดียวคือสติกเกอร์ 30 เหรียญ และ
// max_per_user = 1 (migration 0005) ต้นทุนรวมของโครงการจึงเท่ากับ 35 บาท x จำนวนคนที่เคยแลก
// ไม่ว่าจะจ่ายต่อรายงานเท่าไร เลขตรงนี้จึงไม่ได้กำหนด "ค่าใช้จ่าย" แต่กำหนด "ต้องรายงานกี่ครั้ง
// กว่าจะได้ของ" — ยิ่งตั้งต่ำ ยิ่งได้ข้อมูลหลายครั้งก่อนที่แรงจูงใจจะหมดไปตอนแลกของสำเร็จ
// 2 (+2) = ราว 8-15 ครั้งต่อสติกเกอร์ 1 ชิ้น หรือราว 1-2 สัปดาห์ของคนที่มาเรียนทุกวัน
// FEEDBACK เคยเป็น 30 = ราคาสติกเกอร์พอดี ทำแบบประเมินรอบเดียวก็แลกของได้เลยโดยไม่ต้อง
// รายงานที่จอดสักครั้ง เส้นทางเหรียญจากการรายงานจึงแทบไม่มีความหมาย ลดเหลือครึ่งหนึ่งเพื่อให้
// แบบประเมินเป็น "ตัวช่วยเร่ง" ไม่ใช่ "ทางลัดที่ข้ามระบบทั้งระบบ"
// (ถ้าแก้ตัวเลขนี้ ต้องแก้ FEEDBACK_REWARD_COINS ใน liff/app.js ด้วย ป้ายบนหน้าจอ hardcode ไว้)
//
// SAVE_CAR ลดจาก 5 เพราะการกดจำที่จอดเป็นประโยชน์กับตัวคนกดเอง ไม่ได้สร้างข้อมูลให้คนอื่น
// จึงไม่ควรจ่ายมากกว่ารายงานที่มีคนยืนยันแล้ว (4) — ยังสูงกว่ารายงานเปล่า (2) อยู่เล็กน้อย
// เพราะจำกัดวันละครั้ง เพดานต่อวันจึงยังต่ำกว่าการรายงานอยู่ดี
export const COIN_REWARDS = {
  PARKING_REPORT: 2,
  PARKING_REPORT_CONFIRMED: 2,
  FEEDBACK: 15,
  SAVE_CAR: 3,
};

function nowIso() {
  return new Date().toISOString();
}

// สร้างแถวผู้ใช้ถ้ายังไม่มี — ไม่ต้องมีขั้นตอนสมัครแยก เจอ userId ครั้งแรกก็มีบัญชีเลย
export async function ensureUser(env, userId) {
  const at = nowIso();
  await env.DB.prepare(
    'INSERT INTO users (user_id, coins, created_at, updated_at) VALUES (?, 0, ?, ?) ON CONFLICT(user_id) DO NOTHING'
  ).bind(userId, at, at).run();
}

export async function getUserRow(env, userId) {
  return env.DB.prepare('SELECT user_id, coins, created_at, updated_at FROM users WHERE user_id = ?')
    .bind(userId)
    .first();
}

// บวก/หักเหรียญพร้อมลงรายการใน ledger
//
// ref_id คือตัวกันรับซ้ำ ตกลงกันไว้ที่ UNIQUE (user_id, reason, ref_id) ในสคีมา — ยิงซ้ำจะชน
// constraint แล้ว INSERT ตกไปเอง ไม่ต้องเขียน if เช็คเองแล้วหวังว่าจะครอบคลุมทุกทางเข้า
//
// คืน { awarded, coins, duplicate } — duplicate = true แปลว่าเคยรับรายการนี้ไปแล้ว
export async function applyCoins(env, userId, { delta, reason, refId }) {
  await ensureUser(env, userId);

  const user = await getUserRow(env, userId);
  const balanceAfter = user.coins + delta;

  // กันยอดติดลบตั้งแต่ต้นทาง — สำคัญกับฝั่ง shop ที่หักเหรียญ
  if (balanceAfter < 0) {
    return { awarded: 0, coins: user.coins, duplicate: false, insufficient: true };
  }

  const at = nowIso();
  try {
    // batch = ทรานแซกชันเดียวใน D1 — ledger กับยอดสรุปต้องเข้าหรือไม่เข้าพร้อมกันเท่านั้น
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO coin_ledger (user_id, delta, reason, ref_id, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(userId, delta, reason, refId, balanceAfter, at),
      env.DB.prepare('UPDATE users SET coins = ?, updated_at = ? WHERE user_id = ?')
        .bind(balanceAfter, at, userId),
    ]);
  } catch (err) {
    // ชน UNIQUE = เคยรับรายการนี้ไปแล้ว ถือเป็นผลลัพธ์ปกติ ไม่ใช่ error
    if (String(err && err.message).includes('UNIQUE')) {
      return { awarded: 0, coins: user.coins, duplicate: true };
    }
    throw err;
  }

  return { awarded: delta, coins: balanceAfter, duplicate: false };
}

// คำนวณยอดใหม่จาก ledger ทั้งหมด — ใช้ตอนสงสัยว่ายอดสรุปเพี้ยน
export async function recalculateBalance(env, userId) {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(delta), 0) AS total FROM coin_ledger WHERE user_id = ?')
    .bind(userId)
    .first();
  const total = row ? row.total : 0;
  await env.DB.prepare('UPDATE users SET coins = ?, updated_at = ? WHERE user_id = ?')
    .bind(total, nowIso(), userId)
    .run();
  return total;
}

// GET /api/user?user_id= — โปรไฟล์ + ยอดเหรียญ + สิทธิ์ที่รับไปแล้ว + รายการล่าสุด
export async function handleGetUser(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  if (!userId) return jsonResponse({ error: 'ต้องระบุ user_id' }, 400);

  await ensureUser(env, userId);
  const user = await getUserRow(env, userId);

  // สถานะสิทธิ์อ่านจาก ledger ตรงๆ ไม่ต้องเก็บ flag ซ้ำอีกที่ให้หลุดจากกันได้
  const [claims, history] = await Promise.all([
    env.DB.prepare(
      `SELECT reason, ref_id FROM coin_ledger
        WHERE user_id = ? AND ((reason = 'FEEDBACK' AND ref_id = 'once') OR (reason = 'SAVE_CAR' AND ref_id = ?))`
    ).bind(userId, bangkokDate()).all(),
    env.DB.prepare(
      'SELECT delta, reason, balance_after, created_at FROM coin_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 20'
    ).bind(userId).all(),
  ]);

  const rows = claims.results || [];
  return jsonResponse({
    user: {
      user_id: user.user_id,
      coins: user.coins,
      created_at: user.created_at,
      awards: {
        feedback_done: rows.some((r) => r.reason === 'FEEDBACK'),
        car_saved_today: rows.some((r) => r.reason === 'SAVE_CAR'),
      },
    },
    ledger: history.results || [],
  });
}

// GET /api/user/ledger?user_id= — รายการเข้า-ออกทั้งหมด (ไว้ตรวจย้อนหลัง/หน้าประวัติเหรียญ)
export async function handleGetLedger(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  if (!userId) return jsonResponse({ error: 'ต้องระบุ user_id' }, 400);

  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
  const { results } = await env.DB.prepare(
    'SELECT id, delta, reason, ref_id, balance_after, created_at FROM coin_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ).bind(userId, limit).all();

  return jsonResponse({ ledger: results || [] });
}

async function readUserId(request) {
  try {
    const payload = await request.json();
    return payload && payload.user_id ? String(payload.user_id) : null;
  } catch {
    return null;
  }
}

// POST /api/user/feedback — ครั้งเดียวตลอดชีพ (ref_id คงที่ = 'once') และบันทึกผลลง D1
export async function handleFeedbackAward(request, env) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const userId = body && body.user_id ? String(body.user_id) : null;
  if (!userId) return jsonResponse({ error: 'ต้องระบุ user_id' }, 400);

  // บันทึกคำตอบแบบประเมินลง D1 (ถ้ามีคำตอบส่งมา)
  // ตาราง user_feedback มาจาก migrations/0010_user_feedback.sql แล้ว — ไม่ต้อง CREATE TABLE
  // IF NOT EXISTS ซ้ำในโค้ดฝั่ง handler เพราะ D1 ยังต้อง parse/plan statement นั้นทุกครั้งที่มี
  // คนกดส่งแบบประเมิน ทั้งที่ผลมันเหมือนเดิมทุกครั้ง (ตารางมีอยู่แล้วตั้งแต่ deploy)
  if (body.answers) {
    try {
      const answersJson = typeof body.answers === 'string' ? body.answers : JSON.stringify(body.answers);
      const deviceOs = body.device_os || (body.answers && body.answers.deviceOS) || null;
      const at = nowIso();

      await env.DB.prepare(
        'INSERT INTO user_feedback (user_id, answers_json, device_os, created_at) VALUES (?, ?, ?, ?)'
      ).bind(userId, answersJson, deviceOs, at).run();
    } catch (err) {
      console.error('บันทึก feedback ลง D1 ไม่สำเร็จ', err);
    }
  }

  const result = await applyCoins(env, userId, {
    delta: COIN_REWARDS.FEEDBACK,
    reason: 'FEEDBACK',
    refId: 'once',
  });
  return jsonResponse({
    status: result.duplicate ? 'ALREADY_CLAIMED' : 'SUCCESS',
    coins: result.coins,
    awarded: result.awarded,
  });
}

// POST /api/user/save-car — วันละครั้ง (ref_id = วันที่ตามเวลาไทย)
export async function handleSaveCarAward(request, env) {
  const userId = await readUserId(request);
  if (!userId) return jsonResponse({ error: 'ต้องระบุ user_id' }, 400);

  const result = await applyCoins(env, userId, {
    delta: COIN_REWARDS.SAVE_CAR,
    reason: 'SAVE_CAR',
    refId: bangkokDate(),
  });
  return jsonResponse({
    status: result.duplicate ? 'ALREADY_CLAIMED_TODAY' : 'SUCCESS',
    coins: result.coins,
    awarded: result.awarded,
  });
}

// ให้เหรียญค่ารายงานที่จอด — เรียกจาก handleParkingReport หลังบันทึกรายงานสำเร็จแล้วเท่านั้น
// refId ใช้ reportedAt ของรายงานนั้น ทำให้ 1 รายงาน = 1 ครั้งเสมอ แม้ handler จะถูกเรียกซ้ำ
export async function awardParkingReport(env, userId, reportRefId) {
  return applyCoins(env, userId, {
    delta: COIN_REWARDS.PARKING_REPORT,
    reason: 'PARKING_REPORT',
    refId: reportRefId,
  });
}

// โบนัสความแม่น — จ่ายให้เจ้าของรายงาน "ก่อนหน้า" เมื่อมีคนถัดไปมาเห็นตรงกัน ไม่ใช่จ่ายให้คนที่
// เพิ่งกดตอนนี้ ผู้รับจึงเป็นคนละคนกับผู้เรียก API รอบนี้เสมอ (handleParkingReport กันไว้แล้ว)
//
// refId ใช้ reported_at ของรายงานที่ถูกยืนยัน ไม่ใช่ของรายงานที่มายืนยัน — 1 รายงานจึงรับโบนัสได้
// ครั้งเดียวตลอดกาล ต่อให้มีคนมายืนยันซ้ำหรือ handler ถูกเรียกซ้ำ (UNIQUE ใน coin_ledger ปฏิเสธให้)
export async function awardParkingReportConfirmed(env, userId, confirmedReportRefId) {
  return applyCoins(env, userId, {
    delta: COIN_REWARDS.PARKING_REPORT_CONFIRMED,
    reason: 'PARKING_REPORT_CONFIRMED',
    refId: confirmedReportRefId,
  });
}
