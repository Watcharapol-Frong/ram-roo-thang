// Workers AI + MCP-inspired context retrieval
// CONTEXT.md "MCP-inspired Context Layer" — AI agent เรียก function ของตัวเองตรงๆ ไม่ใช่ MCP Server เต็มสเปก
// ดู docs/adr/0001-function-calling-instead-of-mcp-for-mvp.md
//
// retrieveContext match building ด้วย keyword ง่ายๆ กับ aliases ใน BASELINE_DATA — TODO: ยังไม่ได้
// ทดสอบกับคำถามหลากหลายรูปแบบ (README "ยังไม่ได้ทำ"), และยังไม่ใช่ LLM tool-calling จริงตาม MVP-SPEC §4
// (ยังไม่ได้รันจริงบน @cf/qwen/qwen3-30b-a3b-fp8 — README "ยังไม่ได้ทำ")
//
// callWorkersAI ไม่รับ/คืน context — context อยู่ใน scope ของผู้เรียก (line.js) อยู่แล้ว จึงไม่หายไปพร้อม
// AI error/timeout โดยธรรมชาติ (แก้ bug เดิมที่ทิ้ง context ทิ้งไปตาม README "ส่วนเสริมนอกสเปกเดิม")

import { listBuildings, listServices } from './data.js';

const SYSTEM_INSTRUCTION = `
    คุณคือ "รามรู้ทาง" AI ผู้ช่วยนำทางและให้ข้อมูลที่จอดรถของมหาวิทยาลัยรามคำแหง

    บุคลิก: สุภาพ เป็นกันเอง มีความเป็นมนุษย์ กระชับ ไม่ยืดเยื้อ ช่วยเหลือเต็มที่ (มีอีโมจิประกอบพอเหมาะ)

    *** กฎการสนทนา (สำคัญมาก) ***
    1. รูปแบบข้อความ (Formatting): ห้ามใช้สัญลักษณ์ Markdown เช่น ** (ตัวหนา) หรือ * (ตัวเอียง) เด็ดขาด ให้ใช้ข้อความธรรมดา เว้นวรรค และขึ้นบรรทัดใหม่ในการจัดระเบียบข้อความให้อ่านง่ายเท่านั้น
    2. ประวัติการสนทนา: ตรวจสอบข้อความก่อนหน้า หากเคยทักทายไปแล้ว ให้ "เข้าประเด็นทันที" เป็นธรรมชาติ ไม่ดูเป็นหุ่นยนต์
    3. ความกระชับ: ตอบสั้นๆ ตรงคำถามที่สุด ไม่เกิน 2-3 ประโยค ไม่ต้องอธิบายยืดยาวถ้าไม่จำเป็น
    4. ห้าม Hallucinate: คุณไม่มีฐานข้อมูลอาคาร/ลานจอดรถอยู่ในตัวเอง (ระบบเช็คให้จากฐานข้อมูลจริงแยกต่างหากก่อนถึงคุณเสมอ) ห้ามแต่งชื่อตึก ชื่อลานจอด พิกัด ระยะทาง หรือสถานะที่จอดรถขึ้นมาเองเด็ดขาด ถ้าข้อความที่ส่งมาถึงคุณเป็นคำถามเรื่องอาคาร/ลานจอด ให้ตอบตรงๆ ว่ายังไม่มีข้อมูลอาคารนี้ในระบบ แนะนำให้ลองพิมพ์ชื่ออาคารให้ชัดเจนขึ้น อย่าเดาหรือคาดเดาคำตอบขึ้นมาเอง
    5. การแจ้งสถานะระบบ (Beta): ระบบใช้ข้อมูลอาคาร/ลานจอดรถจริงของมหาวิทยาลัย แต่ตัวบอทเองยังอยู่ในช่วงทดสอบ (Beta) ยังไม่ครอบคลุมทุกกรณีและอาจตอบผิดพลาดได้บ้าง — หากเป็นการสนทนาครั้งแรก หรือผู้ใช้ถามคำถามที่กว้างมาก ให้แทรกประโยคแนบเนียนสั้นๆ ว่า "รามรู้ทางยังอยู่ในช่วงทดสอบระบบ (Beta) นะครับ ข้อมูลอาคาร/ที่จอดรถเป็นข้อมูลจริง แต่ยังตอบผิดพลาดได้บ้าง" ไม่ต้องพูดซ้ำทุกข้อความ

    หน้าที่หลัก: ให้ข้อมูลการเดินทาง ที่จอดรถ อาคาร ตอบเฉพาะสิ่งที่มีข้อมูลจริงรองรับเท่านั้น หากถามนอกเรื่องไม่ตอบคำถาม
  `;

const AI_TIMEOUT_MS = 5000;

// ตัด PII ก่อนส่งเข้า LLM (CONTEXT.md — MVP ไม่เก็บ PII) เรียงจากรูปแบบยาวไปสั้น กัน
// เลขบัตร 13 หลักโดนตัดซ้ำเป็นรหัสนักศึกษา 10 หลักบางส่วน (\b กัน match ทับกันอยู่แล้ว แต่เรียงไว้ให้ชัดเจน)
const PII_PATTERNS = [
  { regex: /\b\d{13}\b/g, replacement: '[NATIONAL_ID]' },
  { regex: /\b0\d{1,2}[-\s]?\d{3}[-\s]?\d{4}\b/g, replacement: '[PHONE_NUMBER]' },
  { regex: /\b\d{10}\b/g, replacement: '[STUDENT_ID]' },
];

export function maskPII(text) {
  return PII_PATTERNS.reduce((masked, { regex, replacement }) => masked.replace(regex, replacement), text);
}

// เลือก alias ที่ "ยาว/เจาะจงที่สุด" ที่ match แทนการคืนตัวแรกที่เจอตามลำดับ array —
// กัน alias สั้นของอาคารหนึ่งบังอาคารอื่นที่ชื่อคาบเกี่ยวกัน เช่น "ECB" (ECB) บัง "ECB2" (ECB2),
// "ตึกส้ม" (SBB) บัง "ตึกส้มเก่า" (SKB) ถ้าเรียงตาม array เฉยๆ ตัวที่มี alias ยาวกว่า/เจาะจงกว่า
// ควรชนะเพราะข้อความ user มักจะ "เจาะจงกว่า" alias สั้นเสมอเวลามันเป็น substring ของ alias ยาว
function findBestAliasMatch(items, normalizedMessage) {
  let best = null;
  let bestAliasLength = 0;
  for (const item of items) {
    if (!Array.isArray(item.aliases)) continue;
    for (const alias of item.aliases) {
      const upperAlias = alias.toUpperCase();
      if (upperAlias.length > bestAliasLength && normalizedMessage.includes(upperAlias)) {
        best = item;
        bestAliasLength = upperAlias.length;
      }
    }
  }
  return { item: best, length: bestAliasLength };
}

export function findByAlias(items, normalizedMessage) {
  return findBestAliasMatch(items, normalizedMessage).item;
}

// จับคู่ userMessage กับ aliases ใน BASELINE_DATA — building ก่อน แล้วค่อย service (docs/adr/0004)
// คืน { building } หรือ { service } หรือ null — services ว่างเปล่าจนกว่าทีมจะกรอกข้อมูลจริง ดังนั้น
// สาขานี้จะยังไม่ match อะไรเลยจนกว่า data/baseline-dataset.json จะมี service เข้าไป
export async function retrieveContext(userMessage, env) {
  const normalized = userMessage.toUpperCase();

  let buildings = [];
  try {
    buildings = await listBuildings(env);
  } catch (e) {
    console.error('retrieveContext: listBuildings error', e);
    buildings = [];
  }

  let services = [];
  try {
    services = await listServices(env);
  } catch (e) {
    console.error('retrieveContext: listServices error', e);
    services = [];
  }

  // เทียบ alias ที่ยาว/เจาะจงที่สุดข้าม 2 หมวดด้วย ไม่ใช่แค่ภายในหมวดเดียวกัน — กัน alias สั้นของ
  // building (เช่น "ทำบัตรนักศึกษา" ของ AOB) บัง alias ยาวกว่าของ service ที่เจาะจงกว่า (เช่น
  // "ทำบัตรนักศึกษาใหม่" ของ STUDENT_CARD_REPLACEMENT) ซึ่งควรตอบด้วยขั้นตอนจริง ไม่ใช่แค่การ์ดตึก
  const buildingMatch = findBestAliasMatch(buildings, normalized);
  const serviceMatch = findBestAliasMatch(services, normalized);

  if (!buildingMatch.item && !serviceMatch.item) return null;
  if (serviceMatch.length > buildingMatch.length) return { service: serviceMatch.item };
  if (buildingMatch.item) return { building: buildingMatch.item };
  return { service: serviceMatch.item };
}

export async function callWorkersAI(userMessage, history, env) {
  let messages = [
    { role: "system", content: SYSTEM_INSTRUCTION }
  ];

  // ตรวจสอบและกรองประวัติแชท ป้องกันค่า Null หรือ Undefined ที่ทำให้เกิด _parseError
  if (Array.isArray(history)) {
    history.forEach(msg => {
      if (msg && typeof msg.text === 'string' && msg.text.trim() !== '') {
        messages.push({
          role: msg.role === 'model' ? 'assistant' : 'user',
          content: msg.text
        });
      }
    });
  }

  const maskedMessage = maskPII(userMessage);
  messages.push({ role: "user", content: maskedMessage });

  try {
    // Race กับ timeout กันเคส Workers AI ค้าง (ไม่ error แค่ช้า) ทำให้ reply token ของ LINE
    // หมดอายุก่อนตอบกลับ (~1 นาที) — ผู้ใช้จะได้ fallback message ทันทีแทนที่จะเงียบไปเลย
    const response = await Promise.race([
      env.AI.run("@cf/qwen/qwen3-30b-a3b-fp8", { messages: messages }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Workers AI timeout")), AI_TIMEOUT_MS)),
    ]);

    if (!response || !response.response) {
       throw new Error("ได้รับข้อมูลเปล่า (Empty Response) จาก Workers AI");
    }

    const aiResponse = response.response.trim();

    history.push({ role: "user", text: maskedMessage });
    history.push({ role: "model", text: aiResponse });

    if (history.length > 6) {
       history = history.slice(history.length - 6);
    }

    return { aiResponseText: aiResponse, newHistory: history };
  } catch (error) {
    console.error("Payload ส่งไปยัง AI:", JSON.stringify(messages, null, 2));
    console.error("Workers AI Error รายละเอียด:", error.message || error);

    return { aiResponseText: "ระบบประมวลผลขัดข้องครับ", newHistory: history };
  }
}
