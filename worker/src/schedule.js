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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
  await ensureUser(env, user_id);

  const id = crypto.randomUUID();
  const { meta } = await env.DB.prepare(
    `INSERT INTO user_courses (id, user_id, course_code, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, course_code) DO NOTHING`
  ).bind(id, user_id, code, new Date().toISOString()).run();

  // changes = 0 แปลว่าชน UNIQUE คือมีวิชานี้อยู่แล้ว ไม่ใช่ error — ตอบให้ฝั่ง UI รู้ว่าไม่ได้เพิ่มใหม่
  const added = meta && meta.changes > 0;
  return jsonResponse({
    status: added ? 'SUCCESS' : 'ALREADY_ADDED',
    schedule: { schedule_id: id, course_code: code },
  });
}

export async function handleGetSchedule(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  if (!userId) return jsonResponse({ error: 'ต้องระบุ user_id' }, 400);

  const { results } = await env.DB.prepare(
    'SELECT id, course_code, created_at FROM user_courses WHERE user_id = ? ORDER BY course_code'
  ).bind(userId).all();

  return jsonResponse({
    schedules: (results || []).map((r) => ({
      schedule_id: r.id,
      course_code: r.course_code,
      created_at: r.created_at,
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
