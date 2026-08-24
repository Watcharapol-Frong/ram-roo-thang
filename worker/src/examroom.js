// อ่านห้องสอบจากรูปตารางสอบที่ผู้ใช้ส่งมาในแชท
//
// ทำไมต้องให้ผู้ใช้ส่งรูป: มหาวิทยาลัยไม่ประกาศห้องสอบเป็นชุดข้อมูลล่วงหน้า ประกาศใกล้สัปดาห์สอบ
// และเป็นรายบุคคลผ่าน e-Service เราจึงดึงเองไม่ได้เลย
//
// เลือก Mistral Small 3.1 หลังทดสอบจริงกับภาพตารางสอบจำลอง (23 ส.ค. 2026):
//   mistral-small-3.1-24b  ถูก 5/5 ใน 6.9 วิ  <- เลือกตัวนี้
//   gemma-4-26b-a4b-it     ถูก 5/5 แต่ 27 วิ (reasoning model เผา token ไปกับการคิด)
//   llama-4-scout-17b      ถูก 4/5 อ่าน ECO1003 เป็น EC01003 (ตัว O เป็นเลข 0)
//   gemma-sea-lion-v4-27b  ถูก 1/5 แต่งรหัสวิชาที่ไม่มีในรูปขึ้นมาเอง ทั้งที่ทำมาเพื่อภาษาแถบนี้
// ทดสอบทั้งภาพคมชัดและภาพจำลองถ่ายจอด้วยมือถือ (เอียง 1.6° ย่อ 760px JPEG q45) ผลเท่ากัน

import examLookup from '../../data/exam-lookup.json' with { type: 'json' };

const VISION_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const VISION_TIMEOUT_MS = 25000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DRAFT_TTL_MINUTES = 30;

// สั่งไม่ให้ดึงชื่อ/รหัสนักศึกษาออกมาตั้งแต่ต้นทาง — รูปตารางสอบมีข้อมูลพวกนี้อยู่ด้วย
// และทั้งโปรเจกต์ตั้งใจไม่เก็บ PII มาตลอด (CONTEXT.md) กันไว้ที่ prompt ดีกว่าไปกรองทีหลัง
const PROMPT = `นี่คือรูปตารางสอบของนักศึกษามหาวิทยาลัยรามคำแหง
อ่านตารางแล้วตอบกลับเป็น JSON array เท่านั้น ห้ามมีข้อความอื่นนอก JSON
แต่ละรายการมีคีย์: course_code (รหัสวิชา เช่น ACC1101), room (ห้องสอบ เช่น VKB 501)
ห้ามดึงชื่อ นามสกุล หรือรหัสประจำตัวนักศึกษาออกมาเด็ดขาด
ถ้าช่องไหนอ่านไม่ออกให้ใส่ null ห้ามเดา`;

function isoNow() {
  return new Date().toISOString();
}

// ดึงไฟล์รูปจาก LINE — เนื้อไฟล์อยู่คนละโดเมนกับ Messaging API ปกติ
export async function fetchLineImage(messageId, accessToken) {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`ดึงรูปจาก LINE ไม่สำเร็จ (${res.status})`);

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('รูปใหญ่เกินไป');
  }
  return buffer;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // แปลงทีละก้อน — String.fromCharCode(...bytes) ทั้งไฟล์ทีเดียวทำ stack overflow ที่ขนาดหลัก MB
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function parseJsonArray(text) {
  if (!text) return null;
  // โมเดลชอบห่อด้วย ```json ... ``` แม้จะสั่งว่าห้ามมีข้อความอื่น
  const match = String(text).match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ตรวจผล OCR กับตารางสอบทางการ — นี่คือหัวใจของความน่าเชื่อถือทั้งฟีเจอร์
//
// เรามีวันสอบ/คาบทางการของครบ 2,865 วิชาอยู่แล้ว จึงเชื่อจากรูปแค่ "ห้องสอบ" อย่างเดียว
// ที่เหลือเอาของทางการทับเสมอ รหัสที่โมเดลอ่านเพี้ยน (เช่น EC01003) หรือแต่งขึ้นมาเอง
// จะไม่มีในชุดข้อมูลและถูกตัดทิ้งตั้งแต่ตรงนี้ ไม่หลุดไปถึงผู้ใช้
export function validateAgainstTimetable(items) {
  const accepted = [];
  const rejected = [];

  for (const item of Array.isArray(items) ? items : []) {
    const code = String(item && item.course_code ? item.course_code : '').toUpperCase().trim();
    const room = item && item.room ? String(item.room).trim().replace(/\s+/g, ' ') : '';

    if (!code || !room) {
      rejected.push({ code: code || '(อ่านไม่ออก)', reason: 'ไม่มีรหัสวิชาหรือห้องสอบ' });
      continue;
    }
    if (!(code in examLookup.courses)) {
      rejected.push({ code, reason: 'ไม่มีรหัสนี้ในตารางสอบของมหาวิทยาลัย' });
      continue;
    }

    const official = examLookup.courses[code];
    accepted.push({
      course_code: code,
      room,
      exam_date: official ? official.slice(0, 10) : null,
      periods: official ? official.slice(10).split('') : [],
    });
  }

  return { accepted, rejected };
}

// อ่านรูป -> ตรวจกับตารางทางการ -> พักไว้เป็น draft รอผู้ใช้กดยืนยัน
export async function processExamScheduleImage(env, userId, messageId) {
  const buffer = await fetchLineImage(messageId, env.LINE_CHANNEL_ACCESS_TOKEN);
  const base64 = toBase64(buffer);

  const aiPromise = env.AI.run(VISION_MODEL, {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
      ],
    }],
    max_tokens: 1200,
  });

  const result = await Promise.race([
    aiPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('vision timeout')), VISION_TIMEOUT_MS)),
  ]);

  const text = result.response ?? result?.choices?.[0]?.message?.content ?? '';
  const { accepted, rejected } = validateAgainstTimetable(parseJsonArray(text));

  if (accepted.length === 0) {
    return { accepted, rejected, draftId: null };
  }

  const draftId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO room_import_drafts (id, user_id, items, created_at) VALUES (?, ?, ?, ?)'
  ).bind(draftId, userId, JSON.stringify(accepted), isoNow()).run();

  return { accepted, rejected, draftId };
}

// บันทึกจริงหลังผู้ใช้กดยืนยัน — เพิ่มวิชาให้ด้วยถ้ายังไม่เคยบันทึกไว้
export async function confirmRoomImport(env, userId, draftId) {
  const draft = await env.DB.prepare(
    'SELECT items, created_at FROM room_import_drafts WHERE id = ? AND user_id = ?'
  ).bind(draftId, userId).first();

  if (!draft) return { ok: false, reason: 'NOT_FOUND' };

  const ageMinutes = (Date.now() - new Date(draft.created_at).getTime()) / 60000;
  if (ageMinutes > DRAFT_TTL_MINUTES) {
    await env.DB.prepare('DELETE FROM room_import_drafts WHERE id = ?').bind(draftId).run();
    return { ok: false, reason: 'EXPIRED' };
  }

  const items = JSON.parse(draft.items);
  const at = isoNow();
  const statements = items.map((item) => env.DB.prepare(
    `INSERT INTO user_courses (id, user_id, course_code, created_at, room, room_source, room_updated_at)
     VALUES (?, ?, ?, ?, ?, 'OCR', ?)
     ON CONFLICT(user_id, course_code)
     DO UPDATE SET room = excluded.room, room_source = 'OCR', room_updated_at = excluded.room_updated_at`
  ).bind(crypto.randomUUID(), userId, item.course_code, at, item.room, at));

  statements.push(env.DB.prepare('DELETE FROM room_import_drafts WHERE id = ?').bind(draftId));
  await env.DB.batch(statements);

  return { ok: true, saved: items.length, items };
}

export async function cancelRoomImport(env, userId, draftId) {
  await env.DB.prepare('DELETE FROM room_import_drafts WHERE id = ? AND user_id = ?')
    .bind(draftId, userId).run();
}
