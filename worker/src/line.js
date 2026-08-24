// LINE webhook: signature verify, chat history, reply
// MVP-SPEC-for-Dev.md §1, §8 — Schedule intent ข้าม AI ไปเลย (ลดจุดเสี่ยง timeout)

import { retrieveContext, callWorkersAI, HISTORY_MAX_MESSAGES } from './ai.js';
import { getServiceByKey, getBuildingByKey, getParkingZoneByKey } from './data.js';
import { resolveStatusForZone } from './parking.js';
import { haversineDistanceMeters } from './utils.js';
import { processExamScheduleImage, confirmRoomImport, cancelRoomImport } from './examroom.js';
import { resultCard, row, FLEX_TOKENS } from './flex.js';

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

// ส่งข้อความหาผู้ใช้โดยไม่ต้องรอให้เขาทักมาก่อน (ใช้กับแจ้งเตือนสอบ)
// ต่างจาก replyToLINE ตรงที่ reply ใช้ได้เฉพาะตอบกลับภายในไม่กี่นาทีหลังผู้ใช้ส่งข้อความมา
//
// ข้อควรรู้: push นับรวมในโควตาข้อความรายเดือนของ LINE OA ส่วน reply ไม่นับ — อย่าเอาไปใช้พร่ำเพรื่อ
// และผู้ใช้ต้องเป็นเพื่อนกับ OA อยู่ ถ้าบล็อกหรือเลิกเป็นเพื่อนจะได้ 403 กลับมา
export async function pushToLINE(userId, messages, accessToken) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ to: userId, messages }),
  });
  if (!res.ok) {
    // ติด status ไปกับ error ด้วย เพราะผู้เรียกต้องแยกให้ออกว่าควรลองใหม่ไหม
    // 4xx = ผู้ใช้บล็อก OA / userId ใช้ไม่ได้ ลองใหม่ก็ไม่มีวันสำเร็จ
    // 5xx หรือเน็ตพัง = ฝั่ง LINE มีปัญหาชั่วคราว ควรได้ลองใหม่รอบหน้า
    const err = new Error(`push ไม่สำเร็จ (${res.status}): ${await res.text().catch(() => '')}`);
    err.status = res.status;
    throw err;
  }
  return res;
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

const PARKING_STATUS_WORD = { GREEN: 'เบาบาง', YELLOW: 'ปานกลาง', RED: 'หนาแน่น' };
const PARKING_STATUS_COLOR = { GREEN: FLEX_TOKENS.green, YELLOW: '#D98E04', RED: FLEX_TOKENS.red };
const WALKING_SPEED_M_PER_MIN = 75;

// การ์ดผลการค้นหาอาคาร
//
// async เพราะต้องไปอ่านลานจอดที่ใกล้ที่สุดกับสถานะล่าสุดของมัน — ข้อมูลสองอย่างนี้คือเหตุผล
// ที่ผู้ใช้ถามหาตึกตั้งแต่แรก เอามาไว้ในการ์ดเลยดีกว่าให้กดเข้าไปดูอีกที
//
// ระยะทางคำนวณจากพิกัดจริงแบบเส้นตรง ไม่ใช่ระยะเดินตามทางจริง จึงเขียนว่า "ประมาณ" เสมอ
// (ระยะเดินจริงคำนวณตอนเปิดแผนที่ด้วย Directions API อยู่แล้ว ไม่ยิง API ซ้ำแค่เพื่อทำการ์ด)
async function generateBuildingCard(env, building, liffUrl) {
  const rows = [];

  if (building.nearest_parking_zone_id) {
    try {
      const zone = await getParkingZoneByKey(env, building.nearest_parking_zone_id);
      if (zone) {
        const status = await resolveStatusForZone(env, zone);
        const level = status && status.status ? status.status : zone.baseline_status;
        const zoneName = String(zone.zone_name).replace(/^ที่จอดรถ\s*/, '');
        rows.push(row('ที่จอดรถใกล้สุด', `${zoneName} (${PARKING_STATUS_WORD[level] || 'ไม่ทราบ'})`, {
          strong: true,
          color: PARKING_STATUS_COLOR[level] || FLEX_TOKENS.ink,
        }));

        const meters = Math.round(haversineDistanceMeters(building.lat, building.lng, zone.lat, zone.lng));
        const minutes = Math.max(1, Math.ceil(meters / WALKING_SPEED_M_PER_MIN));
        rows.push(row('ระยะเดินเท้า', `ประมาณ ${meters} ม. (${minutes} นาที)`));
      }
    } catch (err) {
      // ลานจอดอ่านไม่ได้ไม่ควรทำให้การ์ดทั้งใบหาย — ตัดสองแถวนี้ทิ้งแล้วส่งที่เหลือไป
      console.error('อ่านลานจอดสำหรับการ์ดไม่สำเร็จ', err);
    }
  }

  return resultCard({
    title: 'พบข้อมูลอาคาร',
    badge: building.building_id,
    headerColor: FLEX_TOKENS.blueSoft,
    hero: building.building_id,
    heroNote: building.name_th,
    rows,
    note: '* ข้อมูลการนำทางจะปรับตามตำแหน่ง GPS ของคุณโดยอัตโนมัติ',
    actions: [{ label: 'เริ่มต้นเดินทาง', action: { type: 'uri', label: 'เริ่มต้นเดินทาง', uri: liffUrl || 'https://line.me' } }],
    altText: `ข้อมูล${building.name_th}`,
  });
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
  const uri = liffUrl ? `${liffUrl}${liffUrl.includes('?') ? '&' : '?'}mode=profile` : 'https://line.me';
  return resultCard({
    title: 'ตารางสอบของคุณ',
    badge: 'ตารางสอบ',
    headerColor: FLEX_TOKENS.blueSoft,
    hero: 'บันทึกวิชาที่จะสอบ',
    heroNote: 'ใส่รหัสวิชา ระบบจะดึงวันและคาบสอบจากประกาศให้เอง',
    rows: [
      row('วันสอบ', 'ดึงจากประกาศอัตโนมัติ'),
      row('ห้องสอบ', 'ส่งรูปตารางสอบให้อ่าน'),
      row('แจ้งเตือน', 'ล่วงหน้า 1 วัน'),
    ],
    actions: [{ label: 'เปิดตารางสอบ', action: { type: 'uri', label: 'เปิดตารางสอบ', uri } }],
    altText: 'บันทึกวิชาสอบ',
  });
}

export async function handleWebhookRequest(request, env, ctx) {
  const signature = request.headers.get('x-line-signature');
  const bodyText = await request.text();

  // เช็ค secret ก่อน verify — ถ้า secret หายไปจาก Cloudflare (เคยเกิดจริงตอน worker ถูกเขียนทับ)
  // verifySignature จะเอาสตริง "undefined" ไปทำ HMAC แล้วไม่ตรงกับของ LINE ทุกครั้ง กลายเป็น 401
  // ที่หน้าตาเหมือน "signature ปลอม" ทั้งที่เป็นปัญหา config — บอทเงียบสนิทโดยไม่มีอะไรให้ไล่ตาม
  // แยกเคสนี้ออกมาเป็น 500 พร้อม log ชัดๆ จะได้เห็นสาเหตุจริงทันทีใน `wrangler tail`
  if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) {
    const missing = [
      !env.LINE_CHANNEL_SECRET && 'LINE_CHANNEL_SECRET',
      !env.LINE_CHANNEL_ACCESS_TOKEN && 'LINE_CHANNEL_ACCESS_TOKEN',
    ].filter(Boolean).join(', ');
    console.error(`Webhook misconfigured: secret หายไปจาก worker (${missing}) — แก้ด้วย \`cd worker && npm run deploy\``);
    return new Response('Webhook misconfigured', { status: 500 });
  }

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
  if (history.length > HISTORY_MAX_MESSAGES) {
    history = history.slice(history.length - HISTORY_MAX_MESSAGES);
  }

  try {
    await env.CHAT_HISTORY_RAM.put(userId, JSON.stringify(history), { expirationTtl: 3600 });
  } catch (e) {
    console.error("KV Write Error:", e);
  }
}

// การ์ดสรุปผลอ่านรูป พร้อมปุ่มยืนยัน/ยกเลิก
//
// ต้องให้กดยืนยันเสมอ ห้ามบันทึกทันที — OCR ผิดได้ และผิดแปลว่าคนไปผิดห้องสอบ
// คนที่ตัดสินใจครั้งสุดท้ายต้องเป็นเจ้าของตารางสอบ ไม่ใช่โมเดล
function generateRoomConfirmFlex(accepted, rejected, draftId) {
  const rows = accepted.map((item) =>
    row(item.course_code, item.room, { strong: true, color: FLEX_TOKENS.brand }));

  const note = rejected.length
    ? `อ่านไม่ผ่าน ${rejected.length} รายการ เพราะไม่พบรหัสในตารางสอบของมหาวิทยาลัย — วันสอบใช้ของประกาศเสมอ อ่านจากรูปเฉพาะห้องสอบ ตรวจให้ตรงก่อนกดบันทึกนะครับ`
    : 'วันสอบใช้ของประกาศมหาวิทยาลัยเสมอ อ่านจากรูปเฉพาะห้องสอบ ตรวจให้ตรงก่อนกดบันทึกนะครับ';

  return resultCard({
    title: 'อ่านห้องสอบจากรูปแล้ว',
    badge: `${accepted.length} วิชา`,
    headerColor: FLEX_TOKENS.amberSoft,
    rows,
    note,
    actions: [
      { label: 'บันทึกห้องสอบ', action: { type: 'postback', label: 'บันทึก', data: `rooms_confirm:${draftId}`, displayText: 'บันทึกห้องสอบ' } },
      { label: 'ยกเลิก', color: FLEX_TOKENS.inkFaint, action: { type: 'postback', label: 'ยกเลิก', data: `rooms_cancel:${draftId}`, displayText: 'ยกเลิก' } },
    ],
    altText: `อ่านห้องสอบได้ ${accepted.length} วิชา กดยืนยันเพื่อบันทึก`,
  });
}

// ผู้ใช้ส่งรูปเข้ามา — ถือว่าเป็นรูปตารางสอบเสมอ เพราะเป็นกรณีเดียวที่บอทรับรูป
async function handleImageMessage(event, env) {
  const userId = event.source && event.source.userId;
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (userId) await showLoadingAnimation(userId, token);

  try {
    const { accepted, rejected, draftId } = await processExamScheduleImage(env, userId, event.message.id);

    if (!draftId) {
      const why = rejected.length
        ? 'อ่านรหัสวิชาได้แต่ไม่ตรงกับตารางสอบของมหาวิทยาลัยเลยครับ'
        : 'อ่านตารางจากรูปนี้ไม่ออกครับ';
      return replyToLINE(event.replyToken, [{
        type: 'text',
        text: `${why}\n\nลองถ่ายใหม่ให้เห็นทั้งตารางและตัวหนังสือชัดๆ หรือกรอกห้องสอบเองในแอปก็ได้ครับ`,
      }], token);
    }

    return replyToLINE(event.replyToken, [generateRoomConfirmFlex(accepted, rejected, draftId)], token);
  } catch (err) {
    console.error('อ่านรูปตารางสอบไม่สำเร็จ', err);
    return replyToLINE(event.replyToken, [{
      type: 'text',
      text: 'ตอนนี้อ่านรูปไม่สำเร็จครับ ลองส่งใหม่อีกครั้ง หรือกรอกห้องสอบเองในแอปได้เลย',
    }], token);
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
  // (reuse generateBuildingCard เดิม ไม่ใช่การ์ดใหม่แยกต่างหาก)
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
      [await generateBuildingCard(env, building, withDestId(env.LIFF_URL, building.building_id))],
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }

  // data: "rooms_confirm:{draftId}" / "rooms_cancel:{draftId}" — ผลอ่านห้องสอบจากรูป
  if (action === 'rooms_confirm' && serviceId) {
    const result = await confirmRoomImport(env, userId, serviceId);
    if (!result.ok) {
      const text = result.reason === 'EXPIRED'
        ? 'รายการนี้หมดอายุแล้วครับ (เก็บไว้ 30 นาที) ส่งรูปใหม่อีกครั้งได้เลย'
        : 'ไม่พบรายการนี้แล้วครับ อาจกดไปแล้วหรือยกเลิกไปก่อนหน้านี้';
      return replyToLINE(event.replyToken, [{ type: 'text', text }], env.LINE_CHANNEL_ACCESS_TOKEN);
    }
    const lines = result.items.map((i) => `• ${i.course_code}  ${i.room}`).join('\n');
    return replyToLINE(event.replyToken, [{
      type: 'text',
      text: `บันทึกห้องสอบ ${result.saved} วิชาแล้วครับ\n\n${lines}\n\nจะเตือนพร้อมห้องสอบให้ล่วงหน้า 1 วันครับ`,
    }], env.LINE_CHANNEL_ACCESS_TOKEN);
  }

  if (action === 'rooms_cancel' && serviceId) {
    await cancelRoomImport(env, userId, serviceId);
    return replyToLINE(event.replyToken, [{ type: 'text', text: 'ยกเลิกแล้วครับ ไม่ได้บันทึกอะไรลงไป' }], env.LINE_CHANNEL_ACCESS_TOKEN);
  }

  return null;
}

async function handleEvent(event, env) {
  if (event.type === 'postback') {
    return handlePostback(event, env);
  }

  if (event.type !== 'message') return null;

  // รูป = ตารางสอบที่ผู้ใช้ส่งมาให้อ่านห้องสอบ (ดู worker/src/examroom.js)
  if (event.message.type === 'image') return handleImageMessage(event, env);

  if (event.message.type !== 'text') return null;

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
        await generateBuildingCard(env, context.building, liffUrl)
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
