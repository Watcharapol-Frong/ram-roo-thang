// POST/GET/DELETE /api/schedule — วิชาที่ผู้ใช้บันทึกไว้ดูวันสอบ
// MVP-SPEC-for-Dev.md §6.5-6.7, docs/adr/0003, CONTEXT.md "Student Exam Schedule (No-PII)"
// ผูกกับ LINE userId เท่านั้น ไม่เก็บชื่อ/เบอร์โทร
//
// ย้ายจาก STUDENT_SCHEDULES KV มาที่ D1 พร้อมกับ user/ledger — ได้ของแถมคือ UNIQUE
// (user_id, course_code) กันเพิ่มวิชาซ้ำ ซึ่งของเดิมทำไม่ได้เพราะ key เป็น uuid สุ่มใหม่ทุกครั้ง
// กดปุ่มเพิ่มรัวๆ จะได้วิชาเดิมซ้ำหลายแถวเต็มหน้าจอ
//
// วันสอบ/คาบไม่ได้เก็บที่นี่ — ฝั่ง LIFF เปิดจาก data/exam-lookup.json (ประกาศจริง 2,865 วิชา)
// เก็บไว้ที่เดียวจะได้ไม่มีวันหลุดจากกันตอนมหาวิทยาลัยประกาศตารางใหม่

import { ensureUser } from './user.js';
import { jsonResponse } from './shared.js';

// ห้องสอบยาวสุดที่เจอจริงคือระดับ "VKB 1501" — เผื่อไว้ 40 ตัวก็เกินพอ
// จำกัดไว้เพราะช่องนี้ผู้ใช้พิมพ์เองอิสระ ไม่มีชุดข้อมูลให้ตรวจว่าห้องนั้นมีจริงไหม
const ROOM_MAX_LENGTH = 40;

// คืน string ที่ตัดช่องว่างแล้ว หรือ null ถ้าไม่ได้ส่งมา/ส่งมาว่าง
//
// null กับ '' ต้องแยกกันให้ชัดตลอดทาง: null = "ไม่ได้ยุ่งกับห้อง" (เช่นเพิ่มวิชาเฉยๆ)
// ส่วน '' = "ตั้งใจล้างห้องทิ้ง" ถ้ารวมสองอย่างนี้เป็นค่าเดียว จะไม่มีทางลบห้องที่กรอกผิดไว้ได้เลย
function normalizeRoom(value) {
  if (value === undefined || value === null) return null;
  const room = String(value).trim().replace(/\s+/g, ' ');
  return room.slice(0, ROOM_MAX_LENGTH);
}

export async function handlePostSchedule(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { user_id, course_code } = payload;
  if (!user_id || !course_code) {
    return jsonResponse({ error: 'Missing required fields: user_id, course_code' }, 400);
  }

  const code = String(course_code).toUpperCase().trim();
  // ห้องสอบใส่มาพร้อมตอนเพิ่มวิชาได้ แต่ไม่บังคับ — คนส่วนใหญ่ลงทะเบียนก่อนหลายสัปดาห์
  // แล้วห้องเพิ่งประกาศทีหลัง บังคับกรอกตั้งแต่ตอนเพิ่มคือบังคับให้เดา
  const room = normalizeRoom(payload.room) || null;
  await ensureUser(env, user_id);

  const existing = await env.DB.prepare(
    'SELECT id FROM user_courses WHERE user_id = ? AND course_code = ?'
  ).bind(user_id, code).first();

  const id = existing ? existing.id : crypto.randomUUID();
  const at = new Date().toISOString();

  // ใช้ upsert แม้จะอ่านมาก่อนแล้ว เพราะการอ่านกับการเขียนไม่ได้อยู่ในทรานแซกชันเดียวกัน —
  // ถ้ากดเพิ่มรัวๆ สองครั้งพร้อมกัน INSERT เปล่าๆ จะชน UNIQUE แล้ว throw เป็น 500
  // ผลอ่านข้างบนใช้แค่ตัดสินใจว่าจะรายงานกลับไปว่า "เพิ่มใหม่" หรือ "อัปเดตห้อง"
  //
  // room = null แปลว่าไม่ได้ยุ่งกับห้อง จึงต้อง COALESCE ไม่ให้ไปล้างห้องเดิมทิ้ง
  await env.DB.prepare(
    `INSERT INTO user_courses (id, user_id, course_code, created_at, room, room_source, room_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, course_code)
     DO UPDATE SET
       room            = COALESCE(excluded.room, room),
       room_source     = CASE WHEN excluded.room IS NULL THEN room_source ELSE 'MANUAL' END,
       room_updated_at = CASE WHEN excluded.room IS NULL THEN room_updated_at ELSE excluded.room_updated_at END`
  ).bind(id, user_id, code, at, room, room ? 'MANUAL' : null, room ? at : null).run();

  // อ่านกลับมาจากฐานข้อมูล ไม่ใช่สะท้อนสิ่งที่ผู้ใช้ส่งมา — เคส ALREADY_ADDED ที่ไม่ได้ส่งห้องมา
  // ถ้าตอบ room: null กลับไปจะอ่านได้ว่า "ห้องถูกล้างแล้ว" ทั้งที่ห้องเดิมยังอยู่ครบในฐานข้อมูล
  const saved = await env.DB.prepare(
    'SELECT room, room_source FROM user_courses WHERE id = ?'
  ).bind(id).first();

  const status = !existing ? 'SUCCESS' : (room ? 'UPDATED' : 'ALREADY_ADDED');
  return jsonResponse({
    status,
    schedule: {
      schedule_id: id,
      course_code: code,
      room: (saved && saved.room) || null,
      room_source: (saved && saved.room_source) || null,
    },
  });
}

// POST /api/schedule/room — แก้ห้องสอบของวิชาที่บันทึกไว้แล้ว
//   body: { user_id, schedule_id, room }   room = '' แปลว่าล้างห้องทิ้ง
//
// แยก endpoint ออกมาจาก POST /api/schedule เพราะเป็นคนละเจตนากัน: อันนั้นคือ "เพิ่มวิชา"
// (ถ้าไม่มีก็สร้างให้) ส่วนอันนี้คือ "แก้ของที่มีอยู่" ถ้าไม่มีต้องตอบ 404 ไม่ใช่แอบสร้างใหม่เงียบๆ
export async function handlePatchScheduleRoom(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { user_id, schedule_id } = payload;
  if (!user_id || !schedule_id) {
    return jsonResponse({ error: 'ต้องระบุ user_id และ schedule_id' }, 400);
  }

  const room = normalizeRoom(payload.room);
  if (room === null) {
    return jsonResponse({ error: 'ต้องระบุ room (ส่งค่าว่างเพื่อล้างห้องสอบ)' }, 400);
  }

  const at = new Date().toISOString();
  // มี user_id ในเงื่อนไขเสมอ ไม่ให้แก้ของคนอื่นได้ด้วยการเดา schedule_id (เหมือนตอนลบ)
  const { meta } = await env.DB.prepare(
    `UPDATE user_courses
        SET room = ?, room_source = ?, room_updated_at = ?
      WHERE id = ? AND user_id = ?`
  ).bind(room || null, room ? 'MANUAL' : null, room ? at : null, schedule_id, user_id).run();

  if (!meta || meta.changes === 0) {
    return jsonResponse({ error: 'ไม่พบวิชานี้ในตารางของคุณ' }, 404);
  }

  return jsonResponse({
    status: room ? 'SUCCESS' : 'CLEARED',
    schedule: { schedule_id, room: room || null, room_source: room ? 'MANUAL' : null },
  });
}

export async function handleGetSchedule(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  if (!userId) return jsonResponse({ error: 'ต้องระบุ user_id' }, 400);

  const { results } = await env.DB.prepare(
    'SELECT id, course_code, created_at, room, room_source FROM user_courses WHERE user_id = ? ORDER BY course_code'
  ).bind(userId).all();

  return jsonResponse({
    schedules: (results || []).map((r) => ({
      schedule_id: r.id,
      course_code: r.course_code,
      created_at: r.created_at,
      room: r.room || null,
      room_source: r.room_source || null,
    })),
  });
}

export async function handleDeleteSchedule(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  const scheduleId = url.searchParams.get('schedule_id');
  if (!userId || !scheduleId) {
    return jsonResponse({ error: 'ต้องระบุ user_id และ schedule_id' }, 400);
  }

  // มี user_id ในเงื่อนไขด้วยเสมอ ไม่ให้ลบของคนอื่นได้ด้วยการเดา schedule_id
  await env.DB.prepare('DELETE FROM user_courses WHERE id = ? AND user_id = ?')
    .bind(scheduleId, userId)
    .run();

  return jsonResponse({ status: 'SUCCESS' });
}
