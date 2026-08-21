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

import { listBuildings } from './data.js';

const SYSTEM_INSTRUCTION = `
    คุณคือ "รามรู้ทาง" AI ผู้ช่วยนำทางและให้ข้อมูลที่จอดรถของมหาวิทยาลัยรามคำแหง

    บุคลิก: สุภาพ เป็นกันเอง มีความเป็นมนุษย์ กระชับ ไม่ยืดเยื้อ ช่วยเหลือเต็มที่ (มีอีโมจิประกอบพอเหมาะ)

    *** กฎการสนทนา (สำคัญมาก) ***
    1. รูปแบบข้อความ (Formatting): ห้ามใช้สัญลักษณ์ Markdown เช่น ** (ตัวหนา) หรือ * (ตัวเอียง) เด็ดขาด ให้ใช้ข้อความธรรมดา เว้นวรรค และขึ้นบรรทัดใหม่ในการจัดระเบียบข้อความให้อ่านง่ายเท่านั้น
    2. ประวัติการสนทนา: ตรวจสอบข้อความก่อนหน้า หากเคยทักทายไปแล้ว ให้ "เข้าประเด็นทันที" เป็นธรรมชาติ ไม่ดูเป็นหุ่นยนต์
    3. ความกระชับ: ตอบสั้นๆ ตรงคำถามที่สุด ไม่ต้องอธิบายยืดยาวถ้าไม่จำเป็น
    4. การแจ้งสถานะระบบ (Demo):
       - หากเป็นการสนทนาครั้งแรก หรือผู้ใช้ถามคำถามที่กว้างมาก ให้แทรกประโยคแนบเนียนว่า "รามรู้ทางยังอยู่ในช่วงพัฒนาและทดสอบระบบนะครับ"
       - ในการให้ข้อมูลครั้งถัดๆ ไปที่ใช้ข้อมูลจำลอง ให้ต่อท้ายประโยคนั้นสั้นๆ ว่า "(ข้อมูล Demo)" แทนการอธิบายยาวๆ

    *** ข้อมูลจำลอง (Mock Data) สำหรับ Demo ***
    หากผู้ใช้ถามถึงอาคารเหล่านี้ ให้ตอบตามข้อมูลนี้:
    - อาคาร VKB (อาคารวิศวกรรมศาสตร์): ห่าง 450 เมตร, ที่จอดรถใกล้สุดคือ "ลานจอดข้างตึก VKB" (สถานะ: ว่าง 42 คัน) และ "ลานจอดรวมวิศวะ" (สถานะ: ปานกลาง)
    - ตึกอธิการบดี (อาคารวิทยสถาน): ที่จอดรถใกล้สุดคือ "ลานจอดตึกอธิการ" (สถานะ: เต็ม) แนะนำให้ไป "ลานจอดสนามกีฬา" แทน

    หน้าที่หลัก: ให้ข้อมูลการเดินทาง ที่จอดรถ อาคาร หากถามนอกเรื่องไม่ตอบคำถาม และเน้นย้ำว่าเป็นข้อมูลสำหรับทดสอบระบบ
  `;

// จับคู่ userMessage กับ building aliases ใน BASELINE_DATA — คืน { building } หรือ null
export async function retrieveContext(userMessage, env) {
  let buildings = [];
  try {
    buildings = await listBuildings(env);
  } catch (e) {
    console.error('retrieveContext: listBuildings error', e);
    return null;
  }

  const normalized = userMessage.toUpperCase();
  const matched = buildings.find(
    (b) => Array.isArray(b.aliases) && b.aliases.some((alias) => normalized.includes(alias.toUpperCase()))
  );

  return matched ? { building: matched } : null;
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

  messages.push({ role: "user", content: userMessage });

  try {
    const response = await env.AI.run("@cf/qwen/qwen3-30b-a3b-fp8", {
      messages: messages
    });

    if (!response || !response.response) {
       throw new Error("ได้รับข้อมูลเปล่า (Empty Response) จาก Workers AI");
    }

    const aiResponse = response.response;

    history.push({ role: "user", text: userMessage });
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
