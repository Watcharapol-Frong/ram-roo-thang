// User record + ระบบเหรียญ — เก็บใน USER_PROFILES KV คีย์ `user:{userId}`
//
// ก่อนหน้านี้ไม่มี record ของผู้ใช้อยู่ในระบบเลย ทั้งโปรเจกต์มีแต่ตารางสอบ/รายงานที่จอดที่ผูก
// userId ไว้เฉยๆ ส่วนเหรียญเป็นเลข 120 ฮาร์ดโค้ดในหน้าจอ บวก 30 ที่เก็บใน localStorage —
// ใครเปิด DevTools ก็แก้ยอดตัวเองได้ และล้างข้อมูลเบราว์เซอร์ทีเดียวก็หายหมด
// ยอดเหรียญจึงต้องอยู่ฝั่ง server เท่านั้น ฝั่ง client มีหน้าที่แสดงผลอย่างเดียว
//
// ไม่เก็บ PII — มีแค่ LINE userId เหมือนส่วนอื่นของระบบ (CONTEXT.md "PII")

const USER_KEY_PREFIX = 'user:';

// จำนวนเหรียญของแต่ละการกระทำ — แก้ที่นี่ที่เดียว
export const COIN_REWARDS = {
  PARKING_REPORT: 10,
  FEEDBACK: 30,
  SAVE_CAR: 5,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function newUser(userId) {
  return {
    user_id: userId,
    coins: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    // กันการรับซ้ำ — feedback ให้ครั้งเดียวตลอด, save_car ให้วันละครั้ง
    awards: { feedback_at: null, car_saved_date: null },
    totals: { parking_reports: 0, cars_saved: 0 },
  };
}

export async function getUser(env, userId) {
  const raw = await env.USER_PROFILES.get(`${USER_KEY_PREFIX}${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function putUser(env, user) {
  user.updated_at = new Date().toISOString();
  await env.USER_PROFILES.put(`${USER_KEY_PREFIX}${user.user_id}`, JSON.stringify(user));
  return user;
}

// สร้าง record ให้อัตโนมัติเมื่อเจอ userId ครั้งแรก ไม่ต้องมีขั้นตอนสมัครสมาชิกแยก
export async function getOrCreateUser(env, userId) {
  return (await getUser(env, userId)) || newUser(userId);
}

// เพิ่มเหรียญแล้วบันทึก — คืน user ที่อัปเดตแล้ว
//
// หมายเหตุ: KV เป็น read-modify-write ไม่มี atomic increment ถ้าผู้ใช้คนเดียวกันยิงสองคำขอ
// พร้อมกันเป๊ะๆ ยอดอาจหายไปหนึ่งรายการ ในทางปฏิบัติแทบเป็นไปไม่ได้เพราะทุกทางที่ให้เหรียญ
// มีกลไกกันซ้ำของตัวเองอยู่แล้ว (rate limit 30 นาที / ให้ครั้งเดียว / วันละครั้ง)
async function award(env, user, amount) {
  user.coins += amount;
  return putUser(env, user);
}

// GET /api/user?user_id= — โปรไฟล์ + ยอดเหรียญ (สร้าง record ให้ถ้ายังไม่มี)
export async function handleGetUser(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  if (!userId) return jsonResponse({ error: 'ต้องระบุ user_id' }, 400);

  const existing = await getUser(env, userId);
  const user = existing || (await putUser(env, newUser(userId)));
  return jsonResponse({ user });
}

// POST /api/user/feedback — ให้เหรียญค่าทำแบบประเมิน ครั้งเดียวต่อบัญชี
// เดิมสถานะ "ทำแบบประเมินแล้ว" อยู่ใน localStorage ล้วนๆ ล้างแล้วกดรับใหม่ได้เรื่อยๆ
export async function handleFeedbackAward(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { user_id } = payload;
  if (!user_id) return jsonResponse({ error: 'ต้องระบุ user_id' }, 400);

  const user = await getOrCreateUser(env, user_id);
  if (user.awards.feedback_at) {
    return jsonResponse({ status: 'ALREADY_CLAIMED', coins: user.coins, awarded: 0 });
  }

  user.awards.feedback_at = new Date().toISOString();
  await award(env, user, COIN_REWARDS.FEEDBACK);
  return jsonResponse({ status: 'SUCCESS', coins: user.coins, awarded: COIN_REWARDS.FEEDBACK });
}

// POST /api/user/save-car — ให้เหรียญค่าบันทึกตำแหน่งรถ วันละครั้ง
// ตัวตำแหน่งรถยังเก็บในเครื่องผู้ใช้เหมือนเดิม (ผู้ใช้เลือกไว้ตอนออกแบบฟีเจอร์) ที่ส่งมาที่นี่
// มีแค่ userId เพื่อนับสิทธิ์เหรียญ ไม่ได้ส่งพิกัดรถขึ้น server
export async function handleSaveCarAward(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { user_id } = payload;
  if (!user_id) return jsonResponse({ error: 'ต้องระบุ user_id' }, 400);

  // ใช้วันตามเวลาไทย ไม่ใช่ UTC — ไม่งั้นสิทธิ์จะรีเซ็ตตอนเที่ยงคืนของ UTC (7 โมงเช้าบ้านเรา)
  const bangkokDate = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

  const user = await getOrCreateUser(env, user_id);
  if (user.awards.car_saved_date === bangkokDate) {
    return jsonResponse({ status: 'ALREADY_CLAIMED_TODAY', coins: user.coins, awarded: 0 });
  }

  user.awards.car_saved_date = bangkokDate;
  user.totals.cars_saved += 1;
  await award(env, user, COIN_REWARDS.SAVE_CAR);
  return jsonResponse({ status: 'SUCCESS', coins: user.coins, awarded: COIN_REWARDS.SAVE_CAR });
}

// ให้เหรียญค่ารายงานที่จอด — เรียกจาก handleParkingReport หลังบันทึกรายงานสำเร็จแล้วเท่านั้น
// ไม่ต้องกันซ้ำเองเพราะ rate limit 30 นาที + geofence 150 ม. ของ endpoint นั้นกันให้อยู่แล้ว
export async function awardParkingReport(env, userId) {
  const user = await getOrCreateUser(env, userId);
  user.totals.parking_reports += 1;
  await award(env, user, COIN_REWARDS.PARKING_REPORT);
  return { coins: user.coins, awarded: COIN_REWARDS.PARKING_REPORT };
}
