export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/webhook') {
      return new Response('Not Found', { status: 404 });
    }

    const signature = request.headers.get('x-line-signature');
    const bodyText = await request.text();
    
    if (!signature || !(await verifySignature(bodyText, signature, env.LINE_CHANNEL_SECRET))) {
      return new Response('Unauthorized', { status: 401 });
    }

    try {
      const body = JSON.parse(bodyText);
      const events = body.events || [];

      // ใช้ ctx.waitUntil เพื่อตอบ 200 OK กลับไปหา LINE ทันที ป้องกันปัญหา Webhook Timeout
      ctx.waitUntil(
        Promise.all(events.map(event => handleEvent(event, env)))
      );

      return new Response('OK', { status: 200 });
    } catch (error) {
      console.error('Error in fetch:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};

async function verifySignature(body, signature, channelSecret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(signatureBytes))) === signature;
}

async function showLoadingAnimation(chatId, accessToken) {
  const url = 'https://api.line.me/v2/bot/chat/loading/start';
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ chatId: chatId, loadingSeconds: 5 })
    });
  } catch (e) { console.error("Error showing loading animation", e); }
}

async function handleEvent(event, env) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const userMessage = event.message.text;
  const userId = event.source.userId;

  if (userId) {
     await showLoadingAnimation(userId, env.LINE_CHANNEL_ACCESS_TOKEN);
  }

  // --- 1. ดึงประวัติแชทเดิมจาก Cloudflare KV (แก้เป็น CHAT_HISTORY_RAM แล้ว) ---
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

  // --- 3. บันทึกประวัติใหม่ลง Cloudflare KV (แก้เป็น CHAT_HISTORY_RAM แล้ว) ---
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

async function callWorkersAI(userMessage, history, env) {
  const systemInstruction = `
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

  let messages = [
    { role: "system", content: systemInstruction }
  ];

  // ตรวจสอบและกรองประวัติแชท ป้องกันค่า Null หรือ Undefined ที่ทำให้เกิด _parseError
  if (Array.isArray(history)) {
    history.forEach(msg => {
      // ตรวจสอบว่า msg มีอยู่จริง, text เป็น string และไม่เป็นค่าว่าง
      if (msg && typeof msg.text === 'string' && msg.text.trim() !== '') {
        messages.push({
          role: msg.role === 'model' ? 'assistant' : 'user',
          content: msg.text
        });
      }
    });
  }

  // ใส่คำถามล่าสุด
  messages.push({ role: "user", content: userMessage });

  try {
    const response = await env.AI.run("@cf/qwen/qwen3-30b-a3b-fp8", {
      messages: messages
    });

    // ป้องกันกรณี API คืนค่ากลับมาเป็นค่าว่าง
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
    // พิมพ์ข้อมูล Payload ทั้งหมดลง Log เพื่อให้รู้ว่ามีอะไรแปลกปลอมส่งไปหรือไม่
    console.error("Payload ส่งไปยัง AI:", JSON.stringify(messages, null, 2));
    console.error("Workers AI Error รายละเอียด:", error.message || error);
    
    return { aiResponseText: "ระบบประมวลผลขัดข้องครับ", newHistory: history };
  }
}

async function replyToLINE(replyToken, messages, accessToken) {
  return fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ replyToken: replyToken, messages: messages })
  });
}

function generateFlexMessage(buildingName, buildingDesc, liffUrl) {
  const actionUri = liffUrl || "https://line.me"; 
  return {
    type: "flex",
    altText: `ข้อมูล${buildingName}`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box", layout: "vertical", paddingAll: "16px",
        contents: [
          {
            type: "box", layout: "horizontal",
            contents: [
              {
                type: "box", layout: "vertical",
                contents: [
                  { type: "text", text: buildingName, weight: "bold", size: "lg", color: "#111111" },
                  { type: "text", text: buildingDesc, size: "xs", color: "#666666", margin: "xs" }
                ],
                flex: 4
              },
              {
                type: "box", layout: "vertical", backgroundColor: "#EAF9F1", cornerRadius: "8px", justifyContent: "center", alignItems: "center", width: "32px", height: "32px",
                contents: [{ type: "text", text: "📍", size: "sm" }], flex: 0
              }
            ]
          },
          { type: "separator", margin: "md", color: "#EAEAEA" },
          {
            type: "box", layout: "horizontal", margin: "md", alignItems: "center",
            contents: [
              { type: "text", text: "ℹ️", size: "xs", flex: 0 },
              { type: "text", text: "แตะปุ่มด้านล่างเพื่อเปิดแผนที่และดูที่จอดรถ", size: "xxs", color: "#666666", wrap: true, margin: "sm" }
            ]
          }
        ]
      },
      footer: {
        type: "box", layout: "vertical", paddingTop: "0px", paddingStart: "16px", paddingEnd: "16px", paddingBottom: "16px",
        contents: [
          {
            type: "button", style: "primary", color: "#06C755", height: "sm",
            action: { type: "uri", label: "เปิดระบบนำทาง & ที่จอดรถ", uri: actionUri }
          }
        ]
      },
      styles: { footer: { separator: false } }
    }
  };
}
