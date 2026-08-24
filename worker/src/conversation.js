// สถานะบทสนทนาต่อผู้ใช้หนึ่งคน — ประวัติข้อความ + "เรื่องที่กำลังคุยอยู่"
//
// เดิมบอทนี้ไม่มีบทสนทนา มีแต่ข้อความเดี่ยวๆ ต่อกัน: ทุกข้อความเริ่มนับหนึ่งใหม่ด้วยการเทียบ
// alias กับข้อความปัจจุบันเท่านั้น พอผู้ใช้ถามต่อว่า "ขอขั้นตอนการยื่น" ซึ่งไม่มีชื่อเรื่องอยู่ในประโยค
// ระบบก็ไม่รู้แล้วว่ากำลังพูดถึงใบเช็คเกรดอยู่ — บริการขาดตอนตรงนี้
//
// focus จึงเก็บว่าล่าสุดคุยเรื่องอะไร (บริการหรืออาคาร) แล้วให้คำถามต่อยอดผูกกลับไปหามันได้
//
// เก็บรวมไว้ในคีย์เดียวกับประวัติแชทโดยตั้งใจ ไม่แยกคีย์ใหม่ — KV ฟรีเทียร์เขียนได้ 1,000 ครั้ง/วัน
// และตอนนี้ทุกข้อความเขียนประวัติอยู่แล้วหนึ่งครั้ง ถ้าแยกคีย์จะกลายเป็นสองเท่าทันที (ดู README
// หัวข้อ "Why user data is on D1 and not KV" — โควตา KV คือของที่เคยหมดจนระบบล่มมาแล้ว)

import { HISTORY_MAX_MESSAGES } from './ai.js';

const HISTORY_TTL_SECONDS = 3600;

// เรื่องที่คุยค้างไว้มีอายุสั้นกว่าประวัติแชทมาก — ถามเรื่องขั้นตอนหลังคุยเรื่องอื่นไปครึ่งชั่วโมง
// ไม่ควรถูกลากกลับไปผูกกับบริการเดิม ยอมให้ระบบ "ลืม" ดีกว่าตอบผิดเรื่องอย่างมั่นใจ
const FOCUS_TTL_MS = 15 * 60 * 1000;

const empty = () => ({ messages: [], focus: null });

export async function loadConversation(env, userId) {
  if (!userId || !env.CHAT_HISTORY_RAM) return empty();

  let raw;
  try {
    raw = await env.CHAT_HISTORY_RAM.get(userId);
  } catch (err) {
    console.error('KV Read Error:', err);
    return empty();
  }
  if (!raw) return empty();

  try {
    const parsed = JSON.parse(raw);
    // รูปแบบเดิมเก็บเป็น array ของข้อความล้วน — ผู้ใช้ที่มีประวัติค้างอยู่ตอน deploy ต้องไม่พัง
    if (Array.isArray(parsed)) return { messages: parsed, focus: null };
    return { messages: Array.isArray(parsed.messages) ? parsed.messages : [], focus: parsed.focus || null };
  } catch {
    return empty();
  }
}

export async function saveConversation(env, userId, conversation) {
  if (!userId || !env.CHAT_HISTORY_RAM) return;

  const messages = (conversation.messages || []).slice(-HISTORY_MAX_MESSAGES);
  try {
    await env.CHAT_HISTORY_RAM.put(
      userId,
      JSON.stringify({ messages, focus: conversation.focus || null }),
      { expirationTtl: HISTORY_TTL_SECONDS }
    );
  } catch (err) {
    console.error('KV Write Error:', err);
  }
}

// focus ที่หมดอายุแล้วให้ถือว่าไม่มี — เช็คตอนอ่าน ไม่ใช้ TTL ของ KV เพราะประวัติแชท
// ที่อยู่คีย์เดียวกันต้องอยู่นานกว่า (1 ชม.) ส่วน focus ควรหมดอายุใน 15 นาที
export function activeFocus(conversation) {
  const focus = conversation && conversation.focus;
  if (!focus || !focus.id || !focus.at) return null;
  return Date.now() - focus.at > FOCUS_TTL_MS ? null : focus;
}

export const serviceFocus = (serviceId) => ({ type: 'service', id: serviceId, at: Date.now() });
export const buildingFocus = (buildingId) => ({ type: 'building', id: buildingId, at: Date.now() });

// บันทึกหนึ่งรอบสนทนา (ผู้ใช้ถาม + บอทตอบ) พร้อมอัปเดตเรื่องที่กำลังคุย — เขียน KV ครั้งเดียว
//
// focus = undefined แปลว่า "ไม่เปลี่ยนเรื่อง" (คงของเดิมไว้), focus = null แปลว่า "เลิกคุยเรื่องนั้น"
// สองอย่างนี้ต่างกัน: ตอบคำถามต่อยอดต้องคงเรื่องเดิม ส่วนกดเมนูหลักคือเริ่มใหม่
export async function appendExchange(env, userId, userText, modelText, focus) {
  if (!userId) return;
  const conversation = await loadConversation(env, userId);

  conversation.messages.push({ role: 'user', text: userText });
  conversation.messages.push({ role: 'model', text: modelText });
  if (focus !== undefined) conversation.focus = focus;

  await saveConversation(env, userId, conversation);
}
