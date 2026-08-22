// LINE webhook: signature verify, chat history, reply
// MVP-SPEC-for-Dev.md §1, §8 — Schedule intent ข้าม AI ไปเลย (ลดจุดเสี่ยง timeout)

import { retrieveContext, callWorkersAI } from './ai.js';

export async function verifySignature(body, signature, channelSecret) {
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

export async function replyToLINE(replyToken, messages, accessToken) {
  return fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ replyToken: replyToken, messages: messages })
  });
}

function withDestId(liffUrl, buildingId) {
  if (!liffUrl) return liffUrl;
  const separator = liffUrl.includes('?') ? '&' : '?';
  return `${liffUrl}${separator}dest_id=${encodeURIComponent(buildingId)}`;
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

// บริการ/ขั้นตอนราชการ (docs/adr/0004) — steps เป็นข้อความที่ทีมกรอกไว้ล่วงหน้าใน BASELINE_DATA
// เท่านั้น (ไม่ใช่สิ่งที่ AI แต่งเอง) ปุ่มนำทางจะโผล่เฉพาะตอนมี building_id ผูกไว้
function generateServiceFlexMessage(service, liffUrl) {
  const destUrl = service.building_id ? withDestId(liffUrl, service.building_id) : null;
  return {
    type: "flex",
    altText: service.name,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box", layout: "vertical", paddingAll: "16px",
        contents: [
          { type: "text", text: service.name, weight: "bold", size: "lg", color: "#111111" },
          { type: "text", text: service.steps || "", size: "xs", color: "#666666", margin: "xs", wrap: true }
        ]
      },
      ...(destUrl
        ? {
            footer: {
              type: "box", layout: "vertical", paddingTop: "0px", paddingStart: "16px", paddingEnd: "16px", paddingBottom: "16px",
              contents: [
                {
                  type: "button", style: "primary", color: "#06C755", height: "sm",
                  action: { type: "uri", label: "เปิดระบบนำทางไปอาคาร", uri: destUrl }
                }
              ]
            },
            styles: { footer: { separator: false } }
          }
        : {})
    }
  };
}

function generateScheduleFlexMessage(liffUrl) {
  const actionUri = liffUrl ? `${liffUrl}${liffUrl.includes('?') ? '&' : '?'}mode=profile` : "https://line.me";
  return {
    type: "flex",
    altText: "บันทึกวิชาสอบ",
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box", layout: "vertical", paddingAll: "16px",
        contents: [
          { type: "text", text: "บันทึกวิชาสอบ", weight: "bold", size: "lg", color: "#111111" },
          { type: "text", text: "จดรหัสวิชา อาคาร และเวลาสอบไว้ล่วงหน้า", size: "xs", color: "#666666", margin: "xs", wrap: true }
        ]
      },
      footer: {
        type: "box", layout: "vertical", paddingTop: "0px", paddingStart: "16px", paddingEnd: "16px", paddingBottom: "16px",
        contents: [
          {
            type: "button", style: "primary", color: "#06C755", height: "sm",
            action: { type: "uri", label: "เปิดบันทึกวิชาสอบ", uri: actionUri }
          }
        ]
      },
      styles: { footer: { separator: false } }
    }
  };
}

export async function handleWebhookRequest(request, env, ctx) {
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
    console.error('Error in handleWebhookRequest:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

async function handleEvent(event, env) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const userMessage = event.message.text;
  const userId = event.source.userId;

  if (userId) {
     await showLoadingAnimation(userId, env.LINE_CHANNEL_ACCESS_TOKEN);
  }

  // Schedule intent ข้าม AI ไปเลย (MVP-SPEC §1 หมายเหตุความน่าเชื่อถือ) — ไม่ต้องพึ่ง NLU
  if (userMessage.match(/บันทึกวิชาสอบ|ตารางสอบ/i)) {
    return replyToLINE(
      event.replyToken,
      [
        { type: 'text', text: 'เปิดหน้าบันทึกวิชาสอบได้เลยครับ' },
        generateScheduleFlexMessage(env.LIFF_URL)
      ],
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
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

  // MCP-inspired Context Layer — จับคู่ building ก่อนเรียก AI (CONTEXT.md) เพื่อไม่ให้ context
  // หายไปพร้อม AI error/timeout (ดู README "ส่วนเสริมนอกสเปกเดิม")
  const context = await retrieveContext(userMessage, env);

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

  if (context && context.building) {
    // เจอ building จริงใน BASELINE_DATA — ใช้ dest_id พาไปหน้า nav ตรงตึกนั้นได้เลย (MVP-SPEC §7)
    messagesToReply.push(generateFlexMessage(
      context.building.name_th,
      "แตะปุ่มด้านล่างเพื่อดูเส้นทางและที่จอดรถ",
      withDestId(env.LIFF_URL, context.building.building_id)
    ));
  } else if (context && context.service) {
    // เจอบริการ/ขั้นตอนราชการที่ทีมกรอกไว้ล่วงหน้า (docs/adr/0004) — services ว่างอยู่จนกว่าจะมีข้อมูลจริง
    messagesToReply.push(generateServiceFlexMessage(context.service, env.LIFF_URL));
  } else if (userMessage.match(/แผนที่|ตึก|อาคาร|ที่จอดรถ|จอดรถ|นำทาง/i)) {
    // ยังไม่มี BASELINE_DATA ที่ match ได้ (หรือยังไม่ seed) — คง mock เดิมไว้กัน demo พัง
    const buildingName = userMessage.toUpperCase().includes('VKB') ? 'อาคาร VKB' : 'อาคารเป้าหมาย';
    const buildingDesc = userMessage.toUpperCase().includes('VKB') ? 'คณะวิศวกรรมศาสตร์' : 'ระบบนำทางและข้อมูลที่จอดรถ';
    messagesToReply.push(generateFlexMessage(buildingName, buildingDesc, env.LIFF_URL));
  }

  return replyToLINE(event.replyToken, messagesToReply, env.LINE_CHANNEL_ACCESS_TOKEN);
}
