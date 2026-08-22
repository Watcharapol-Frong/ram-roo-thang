// LINE webhook: signature verify, chat history, reply
// MVP-SPEC-for-Dev.md §1, §8 — Schedule intent ข้าม AI ไปเลย (ลดจุดเสี่ยง timeout)

import { retrieveContext, callWorkersAI } from './ai.js';
import { getServiceByKey, getBuildingByKey } from './data.js';

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

function withParkingZoneId(liffUrl, zoneId) {
  if (!liffUrl) return liffUrl;
  const separator = liffUrl.includes('?') ? '&' : '?';
  return `${liffUrl}${separator}mode=parking&zone_id=${encodeURIComponent(zoneId)}`;
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

// บริการ/ขั้นตอนราชการ (docs/adr/0004) — short_answer/steps เป็นข้อความที่ทีมกรอกไว้ล่วงหน้าใน
// BASELINE_DATA เท่านั้น (ไม่ใช่สิ่งที่ AI แต่งเอง) ตอบเป็นข้อความแชทธรรมดา + quick reply postback
// (ไม่ใช้ Flex Message สำหรับคำตอบสั้นนี้ — เก็บ Flex ไว้ใช้ตอนกด "สร้างเส้นทาง" ให้เหมือนหน้าตา
// การนำทางปกติเท่านั้น ดู service_nav ใน handlePostback ด้านล่าง)
function generateServiceSummaryMessage(service) {
  const items = [];
  if (service.building_id) {
    items.push({
      type: "action",
      action: { type: "postback", label: "🧭 สร้างเส้นทาง", data: `service_nav:${service.service_id}`, displayText: "ขอเส้นทางไปอาคาร" }
    });
  }
  items.push({
    type: "action",
    action: { type: "postback", label: "📋 ดูขั้นตอนทั้งหมด", data: `service_steps:${service.service_id}`, displayText: `ขอดูขั้นตอน: ${service.name}` }
  });

  return {
    type: 'text',
    text: `${service.name}\n${service.short_answer || service.steps || ''}`,
    quickReply: { items }
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

// สุ่มสลับประโยคแทนข้อความตายตัวเดียว กันความรู้สึก "หุ่นยนต์พูดประโยคเดียวซ้ำ" ในเส้นทาง
// fast-path (ไม่เรียก AI) — สุ่มในโค้ดล้วนๆ ไม่มี latency เพิ่ม ไม่กระทบความเสี่ยง hallucinate เดิม
const BUILDING_FOUND_PHRASES = [
  (name) => `${name} อยู่ตรงนี้ครับ 😊`,
  (name) => `เจอแล้วครับ ${name} 😊`,
  (name) => `${name} ครับ กดดูเส้นทางได้เลย 😊`,
  (name) => `นี่เลยครับ ${name} 😊`,
];

function pickBuildingFoundPhrase(name) {
  const phrase = BUILDING_FOUND_PHRASES[Math.floor(Math.random() * BUILDING_FOUND_PHRASES.length)];
  return phrase(name);
}

// ห้าม hardcode ชื่อตึกจำเพาะ (เช่น VKB) ในนี้เด็ดขาด — ปุ่มนี้แปะอยู่ท้ายทุกข้อความไม่ว่ากำลัง
// คุยเรื่องตึกไหนอยู่ ถ้า hardcode ตึกใดตึกหนึ่งไว้ จะพาออกนอกบริบทเดิมทันทีที่กด (เจอบั๊กนี้มาแล้ว
// ตอน hardcode VKB ไว้ ทั้งที่กำลังคุยเรื่องตึกอื่นอยู่)
const QUICK_REPLY_ITEMS = {
  items: [
    {
      type: "action",
      action: {
        type: "message",
        label: "📍 ค้นหาอาคาร",
        text: "ค้นหาอาคาร"
      }
    },
    {
      type: "action",
      action: {
        type: "message",
        label: "🚗 เช็คที่จอดรถ",
        text: "เช็คที่จอดรถ"
      }
    }
  ]
};

// บันทึก exchange ลง CHAT_HISTORY_RAM — ใช้ร่วมกันทั้ง fast-path, postback, และ AI path
// เพื่อให้คำถามต่อยอด (เช่น "ขอรายละเอียด") มี context ว่าเพิ่งคุยอะไรไป ไม่ใช่แค่ AI path
// เท่านั้นที่บันทึก (เดิมพลาดตรงนี้ — fast-path/postback ไม่เคยเขียน history เลย ทำให้คำถามต่อยอด
// หลุดไปเจอ history เก่า/ว่างเปล่า)
async function appendHistory(env, userId, userMessage, modelText) {
  if (!userId) return;
  let history = [];
  try {
    const stored = await env.CHAT_HISTORY_RAM.get(userId);
    if (stored) history = JSON.parse(stored);
  } catch (e) {
    console.error("KV Read Error:", e);
  }

  history.push({ role: 'user', text: userMessage });
  history.push({ role: 'model', text: modelText });
  if (history.length > 6) {
    history = history.slice(history.length - 6);
  }

  try {
    await env.CHAT_HISTORY_RAM.put(userId, JSON.stringify(history), { expirationTtl: 3600 });
  } catch (e) {
    console.error("KV Write Error:", e);
  }
}

// ปุ่ม quick reply ใน generateServiceSummaryMessage ส่ง postback data มาที่นี่
// steps/building เป็นข้อมูลที่ทีมกรอกไว้ล่วงหน้าเท่านั้น ไม่ใช่สิ่งที่ AI แต่งเอง
async function handlePostback(event, env) {
  const data = event.postback && event.postback.data ? event.postback.data : '';
  const [action, serviceId] = data.split(':');
  const userId = event.source && event.source.userId;
  const displayText = (event.postback && event.postback.displayText) || data;

  // data: "service_steps:{service_id}" — ตอบ steps เต็มเป็นข้อความแชท
  if (action === 'service_steps' && serviceId) {
    const service = await getServiceByKey(env, serviceId);
    if (!service) {
      return replyToLINE(event.replyToken, [{ type: 'text', text: 'ไม่พบข้อมูลขั้นตอนนี้ครับ' }], env.LINE_CHANNEL_ACCESS_TOKEN);
    }
    const replyText = `${service.name}\n\n${service.steps}`;
    await appendHistory(env, userId, displayText, replyText);
    return replyToLINE(
      event.replyToken,
      [{ type: 'text', text: replyText }],
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }

  // data: "service_nav:{service_id}" — สร้าง Flex Message นำทางแบบเดียวกับการบอกทางตึกปกติ
  // (reuse generateFlexMessage เดิม ไม่ใช่การ์ดใหม่แยกต่างหาก)
  if (action === 'service_nav' && serviceId) {
    const service = await getServiceByKey(env, serviceId);
    if (!service || !service.building_id) {
      return replyToLINE(event.replyToken, [{ type: 'text', text: 'ไม่พบข้อมูลอาคารสำหรับบริการนี้ครับ' }], env.LINE_CHANNEL_ACCESS_TOKEN);
    }
    const building = await getBuildingByKey(env, service.building_id);
    if (!building) {
      return replyToLINE(event.replyToken, [{ type: 'text', text: 'ไม่พบข้อมูลอาคารนี้ครับ' }], env.LINE_CHANNEL_ACCESS_TOKEN);
    }
    await appendHistory(env, userId, displayText, `เปิดเส้นทางไป ${building.name_th} ให้แล้วครับ`);
    return replyToLINE(
      event.replyToken,
      [generateFlexMessage(
        building.name_th,
        "แตะปุ่มด้านล่างเพื่อดูเส้นทางและที่จอดรถ",
        withDestId(env.LIFF_URL, building.building_id)
      )],
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }

  return null;
}

async function handleEvent(event, env) {
  if (event.type === 'postback') {
    return handlePostback(event, env);
  }

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

  // เมนู/ช่วยเหลือ — ทักทายสั้นๆ ข้าม AI ไปเลยเหมือนกัน (ลด latency สำหรับ intent ที่ตอบตายตัวได้)
  if (userMessage.match(/^(เมนู|ช่วยเหลือ|help|menu)$/i)) {
    return replyToLINE(
      event.replyToken,
      [{
        type: 'text',
        text: 'รามรู้ทางช่วยอะไรได้บ้าง 😊\nถามหาตึก / เช็คที่จอดรถ / บันทึกวิชาสอบ ได้เลยครับ',
        quickReply: QUICK_REPLY_ITEMS
      }],
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }

  // MCP-inspired Context Layer — จับคู่ building/service ก่อนเสมอ (CONTEXT.md)
  const context = await retrieveContext(userMessage, env);

  // Fast-path: match ชัดเจนอยู่แล้วจาก BASELINE_DATA ไม่ต้องรอ AI เลย — ตัด latency/timeout risk
  // สำหรับ intent ที่ตอบได้ตรงๆ อยู่แล้ว — บันทึกลง CHAT_HISTORY_RAM ด้วย (เดิมไม่บันทึก ทำให้
  // คำถามต่อยอดของผู้ใช้ เช่น "ขอรายละเอียด" หลุดไปเจอ AI ที่ไม่รู้บริบทอะไรเลย)
  if (context && context.building) {
    // ถามเจาะจงเรื่องที่จอดรถ + ตึกนี้ผูก zone ไว้แล้ว -> พาไปหน้ารายงาน/เช็คสถานะ zone นั้นตรงๆ
    // (ข้าม nearest-zone lookup ฝั่ง LIFF ไปเลย) ไม่งั้น fallback เป็นหน้านำทางปกติเหมือนเดิม
    const isParkingQuestion = userMessage.match(/ที่จอดรถ|จอดรถ|parking/i);
    const liffUrl = isParkingQuestion && context.building.nearest_parking_zone_id
      ? withParkingZoneId(env.LIFF_URL, context.building.nearest_parking_zone_id)
      : withDestId(env.LIFF_URL, context.building.building_id);
    const replyPhrase = pickBuildingFoundPhrase(context.building.name_th);

    await appendHistory(env, userId, userMessage, replyPhrase);
    return replyToLINE(
      event.replyToken,
      [
        {
          type: 'text',
          text: replyPhrase,
          quickReply: QUICK_REPLY_ITEMS
        },
        generateFlexMessage(
          context.building.name_th,
          "แตะปุ่มด้านล่างเพื่อดูเส้นทางและที่จอดรถ",
          liffUrl
        )
      ],
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }
  if (context && context.service) {
    const replySummary = `${context.service.name}: ${context.service.short_answer || ''}`;
    await appendHistory(env, userId, userMessage, replySummary);
    return replyToLINE(
      event.replyToken,
      [generateServiceSummaryMessage(context.service)],
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

  // --- 2. ส่งประวัติเดิม + ข้อความใหม่ ไปให้ Workers AI ---
  const { aiResponseText, newHistory } = await callWorkersAI(userMessage, history, env);

  // --- 3. บันทึกประวัติใหม่ลง Cloudflare KV (CHAT_HISTORY_RAM) ---
  try {
    await env.CHAT_HISTORY_RAM.put(userId, JSON.stringify(newHistory), { expirationTtl: 3600 });
  } catch (e) {
    console.error("KV Write Error:", e);
  }

  // ถึงตรงนี้ context ไม่ match building/service แล้ว (เช็คไปแล้วด้านบน) — ตอบด้วยข้อความ AI ตรงๆ
  // ไม่มี fallback แต่งข้อมูลตึกเพิ่มอีกแล้ว (ของเดิม hardcode VKB=คณะวิศวกรรมศาสตร์ ผิดตั้งแต่ VKB
  // ในฐานข้อมูลจริงเปลี่ยนเป็นเวียงคำ) — BASELINE_DATA ครอบคลุมจริงแล้ว ถ้าไม่ match คือไม่มีข้อมูลจริง
  // SYSTEM_INSTRUCTION ข้อ 4 สั่งให้ AI ตอบตรงๆ ว่าไม่มีข้อมูลอยู่แล้ว ไม่ต้องแต่งการ์ดมาปิดบัง
  const messagesToReply = [
    {
      type: 'text',
      text: aiResponseText,
      quickReply: QUICK_REPLY_ITEMS
    }
  ];

  return replyToLINE(event.replyToken, messagesToReply, env.LINE_CHANNEL_ACCESS_TOKEN);
}
