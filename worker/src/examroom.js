// อ่านวิชา (และห้องสอบถ้ามี) จากรูปเอกสารที่ผู้ใช้ส่งมาในแชท
//
// ทำไมต้องให้ผู้ใช้ส่งรูป: มหาวิทยาลัยไม่ประกาศห้องสอบเป็นชุดข้อมูลล่วงหน้า ประกาศใกล้สัปดาห์สอบ
// และเป็นรายบุคคลผ่าน e-Service เราจึงดึงเองไม่ได้เลย
//
// รับได้ทั้งใบลงทะเบียนเรียนและตารางสอบรายบุคคล — ห้องสอบเป็นของที่ "มีก็ดี" ไม่ใช่เงื่อนไขบังคับ
//
// เดิมบังคับว่าแถวไหนไม่มีห้องสอบให้ทิ้งทั้งแถว ผลคือใบลงทะเบียน (ซึ่งมีแต่รหัสวิชากับหน่วยกิต
// ไม่มีคอลัมน์ห้องเลย) ถูกปฏิเสธทั้งใบ แล้วขึ้นข้อความว่า "ไม่ตรงกับตารางสอบของมหาวิทยาลัย"
// ทั้งที่ทุกรหัสในรูปมีอยู่ในตารางสอบครบ — บอกสาเหตุผิดด้วย ผู้ใช้เลยไปถ่ายรูปใหม่ซ้ำๆ ฟรี
//
// ลำดับการใช้งานจริงคือลงทะเบียนก่อนหลายสัปดาห์ แล้วห้องสอบเพิ่งประกาศทีหลัง ระบบจึงต้องรับ
// เอกสารที่ยังไม่มีห้องได้ แล้วค่อยเติมห้องเข้ามาทีหลัง (ส่งรูปตารางสอบซ้ำ หรือกรอกเองในแอป)
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
const PROMPT = `นี่คือรูปเอกสารของนักศึกษามหาวิทยาลัยรามคำแหง อาจเป็นใบลงทะเบียนเรียนหรือตารางสอบรายบุคคล
อ่านทุกแถวที่มีรหัสวิชา แล้วตอบกลับเป็น JSON array เท่านั้น ห้ามมีข้อความอื่นนอก JSON
แต่ละรายการมีคีย์: course_code (รหัสวิชา เช่น ACC1101), room (ห้องสอบ เช่น VKB 501)
เอกสารบางแบบไม่มีคอลัมน์ห้องสอบเลย ถ้าไม่มีห้องหรืออ่านห้องไม่ออกให้ใส่ room เป็น null
ห้ามเดาห้องสอบเด็ดขาด และห้ามเอาหน่วยกิตหรือเลขอื่นมาใส่เป็นห้องสอบ
ห้ามดึงชื่อ นามสกุล หรือรหัสประจำตัวนักศึกษาออกมาเด็ดขาด`;

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
// เรามีวันสอบ/คาบทางการของครบ 2,865 วิชาอยู่แล้ว จึงเชื่อจากรูปแค่ "รหัสวิชา" กับ "ห้องสอบ"
// ที่เหลือเอาของทางการทับเสมอ รหัสที่โมเดลอ่านเพี้ยน (เช่น EC01003) หรือแต่งขึ้นมาเอง
// จะไม่มีในชุดข้อมูลและถูกตัดทิ้งตั้งแต่ตรงนี้ ไม่หลุดไปถึงผู้ใช้
//
// เกณฑ์ผ่านมีข้อเดียว: รหัสวิชาต้องมีอยู่จริงในตารางสอบ ส่วนห้องสอบไม่มีก็ได้ (room = null)
// ห้องเป็นข้อมูลที่เติมทีหลังได้ แต่รหัสวิชาที่ผิดคือข้อมูลที่ผิดตั้งแต่ต้น แก้ทีหลังไม่ได้
export function validateAgainstTimetable(items) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    const code = String(item && item.course_code ? item.course_code : '').toUpperCase().trim();
    const room = item && item.room ? String(item.room).trim().replace(/\s+/g, ' ') : '';

    if (!code) {
      rejected.push({ code: '(อ่านไม่ออก)', reason: 'อ่านรหัสวิชาไม่ออก' });
      continue;
    }
    if (!(code in examLookup.courses)) {
      rejected.push({ code, reason: 'ไม่มีรหัสนี้ในตารางสอบของมหาวิทยาลัย' });
      continue;
    }
    // เอกสารบางใบมีรหัสเดิมซ้ำ (เช่นถ่ายติดทั้งสองคอลัมน์) — กันไว้ตรงนี้ ไม่งั้นการ์ดยืนยัน
    // จะโชว์วิชาเดียวกันซ้ำๆ ทั้งที่ตอนบันทึกจริง UNIQUE (user_id, course_code) รวมให้เหลือแถวเดียว
    if (seen.has(code)) continue;
    seen.add(code);

    const official = examLookup.courses[code];
    accepted.push({
      course_code: code,
      room: room || null,
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
//
// รายการที่ไม่มีห้อง (room = null) ต้อง "ไม่ไปทับ" ห้องเดิมที่ผู้ใช้เคยกรอกไว้เอง — ไม่งั้น
// ส่งใบลงทะเบียนเข้ามาทีหลังทีเดียว ห้องที่กรอกไว้ทั้งเทอมหายเกลี้ยง จึงใช้ COALESCE
// และแตะ room_source/room_updated_at เฉพาะตอนที่มีห้องใหม่จริงๆ เท่านั้น
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
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, course_code)
     DO UPDATE SET
       room            = COALESCE(excluded.room, room),
       room_source     = CASE WHEN excluded.room IS NULL THEN room_source ELSE 'OCR' END,
       room_updated_at = CASE WHEN excluded.room IS NULL THEN room_updated_at ELSE excluded.room_updated_at END`
  ).bind(crypto.randomUUID(), userId, item.course_code, at,
         item.room || null, item.room ? 'OCR' : null, item.room ? at : null));

  statements.push(env.DB.prepare('DELETE FROM room_import_drafts WHERE id = ?').bind(draftId));
  await env.DB.batch(statements);

  const withRoom = items.filter((i) => i.room).length;
  return { ok: true, saved: items.length, withRoom, withoutRoom: items.length - withRoom, items };
}

export async function cancelRoomImport(env, userId, draftId) {
  await env.DB.prepare('DELETE FROM room_import_drafts WHERE id = ? AND user_id = ?')
    .bind(draftId, userId).run();
}
