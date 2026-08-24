// เก็บคำถามที่ระบบตอบไม่ได้ ไว้ดูว่าควรเติมข้อมูลอะไรต่อ
//
// ที่ผ่านมาเรารู้ว่าบอทตอบไม่ได้ก็ต่อเมื่อมีคนแคปหน้าจอมาให้ดูเท่านั้น ซึ่งแปลว่าเคสที่ผู้ใช้
// เจอแล้วเงียบๆ เลิกใช้ไป เราไม่มีทางรู้เลย ตารางนี้ทำให้เห็นเองโดยไม่ต้องรอ feedback
//
// เขียนเฉพาะตอนตอบไม่ได้จริงๆ ปริมาณจึงน้อย ไม่กระทบโควตา D1 (ต่างจากการ log ทุกข้อความ)

import { maskPII } from './ai.js';

const MAX_MESSAGE_LENGTH = 200;

export async function logUnanswered(env, { message, intent = null, focusId = null, reason }) {
  if (!env || !env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO unanswered_queries (id, message, intent, focus_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      maskPII(String(message || '')).slice(0, MAX_MESSAGE_LENGTH),
      intent,
      focusId,
      reason,
      new Date().toISOString()
    ).run();
  } catch (err) {
    // ตกบันทึกไม่ใช่เหตุผลที่จะทำให้ผู้ใช้ไม่ได้รับคำตอบ — กลืนทิ้งเสมอ
    console.error('logUnanswered ไม่สำเร็จ', err);
  }
}

// GET /api/admin/unanswered?limit=100 — ต้องมี x-admin-token
//
// จัดกลุ่มตามข้อความที่ซ้ำกันให้เลย เพราะสิ่งที่อยากรู้คือ "คำถามแบบไหนถูกถามบ่อยแล้วเราตอบไม่ได้"
// ไม่ใช่รายการดิบเรียงตามเวลา
export async function handleAdminUnanswered(request, env) {
  const token = request.headers.get('x-admin-token');
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);

  const { results } = await env.DB.prepare(
    `SELECT message, intent, focus_id, reason, COUNT(*) AS times, MAX(created_at) AS last_at
       FROM unanswered_queries
      GROUP BY message, intent, focus_id, reason
      ORDER BY times DESC, last_at DESC
      LIMIT ?`
  ).bind(limit).all();

  return new Response(JSON.stringify({ groups: results || [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
