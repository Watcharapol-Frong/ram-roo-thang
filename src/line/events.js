import { showLoadingAnimation, replyToLINE } from './reply.js';
import { generateFlexMessage } from './flexMessage.js';
import { callWorkersAI } from '../ai/client.js';

export async function handleEvent(event, env) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const userMessage = event.message.text;
  const userId = event.source.userId;

  if (userId) {
     await showLoadingAnimation(userId, env.LINE_CHANNEL_ACCESS_TOKEN);
  }

  // --- 1. ดึงประวัติแชทเดิมจาก Cloudflare KV (CHAT_HISTORY_RAM) ---
  let history = [];
  try {
    const storedHistory = await env.CHAT_HISTORY_RAM.get(userId);
    if (storedHistory) {
      history = JSON.parse(storedHistory);
    }
  } catch (e) {
    console.error("KV Read Error:", e);
  }

  // --- 2. ส่งประวัติเดิม + ข้อความใหม่ ไปให้ Workers AI ---
  const { aiResponseText, newHistory } = await callWorkersAI(userMessage, history, env);

  // --- 3. บันทึกประวัติใหม่ลง Cloudflare KV (CHAT_HISTORY_RAM) ---
  try {
    await env.CHAT_HISTORY_RAM.put(userId, JSON.stringify(newHistory), { expirationTtl: 3600 });
  } catch (e) {
    console.error("KV Write Error:", e);
  }

  // เตรียมข้อความตอบกลับ พร้อม Quick Reply buttons ด้านล่าง
  let messagesToReply = [
    {
      type: 'text',
      text: aiResponseText,
      quickReply: {
        items: [
          {
            type: "action",
            action: {
              type: "message",
              label: "📍 ค้นหาอาคาร",
              text: "อาคาร VKB อยู่ที่ไหน"
            }
          },
          {
            type: "action",
            action: {
              type: "message",
              label: "🚗 เช็คที่จอดรถ",
              text: "ที่จอดรถตู้ VKB ว่างไหม"
            }
          }
        ]
      }
    }
  ];

  if (userMessage.match(/แผนที่|ตึก|อาคาร|ที่จอดรถ|จอดรถ|นำทาง/i)) {
    const buildingName = userMessage.toUpperCase().includes('VKB') ? 'อาคาร VKB' : 'อาคารเป้าหมาย';
    const buildingDesc = userMessage.toUpperCase().includes('VKB') ? 'คณะวิศวกรรมศาสตร์' : 'ระบบนำทางและข้อมูลที่จอดรถ';
    messagesToReply.push(generateFlexMessage(buildingName, buildingDesc, env.LIFF_URL));
  }

  return replyToLINE(event.replyToken, messagesToReply, env.LINE_CHANNEL_ACCESS_TOKEN);
}
