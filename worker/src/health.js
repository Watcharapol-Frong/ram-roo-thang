// เช็คว่าบอทออนไลน์อยู่จริงไหม
//
// "ออนไลน์" ที่คนถามกัน มีสองความหมายซ้อนกันอยู่ ต้องตอบให้ครบทั้งคู่:
//   1. worker ยังรับคำขอได้ไหม            -> ping /api/health ก็รู้แล้ว
//   2. บอทยัง "ตอบแชท" ได้จริงไหม          -> ต้องดูของที่บอทต้องใช้ทีละอย่าง
//
// ข้อ 2 คือข้อที่เคยพัง: 22 ส.ค. 2026 worker ถูกเขียนทับจนไม่มี secret เหลือ ทุกอย่างยัง
// ตอบ 200 หมด แต่ทุก webhook จาก LINE ตกที่ verifySignature — บอทเงียบสนิทโดยไม่มีสัญญาณอะไรเลย
// การเช็คแค่ว่า URL ตอบได้จึงไม่พอ ต้องเช็คของที่บอทต้องใช้จริง + ดูว่ามี event เข้ามาล่าสุดเมื่อไหร่
//
// ระดับผลลัพธ์มีสามชั้น ไม่ใช่ ok/fail:
//   ok       ใช้งานได้ครบ
//   degraded ตอบแชทได้ แต่บางอย่างหาย (เช่น AI ล่ม -> ยังค้นตึกได้ แต่คุยไม่ได้)
//   down     ตอบแชทไม่ได้เลย (secret หาย / D1 ล่ม / token LINE ใช้ไม่ได้)
// แยกแบบนี้เพราะ "AI ล่ม" กับ "บอทตายทั้งตัว" ไม่ควรทำให้คนดูตื่นเท่ากัน

import { resultCard, row, FLEX_TOKENS } from './flex.js';
import { isAdminRequest, bangkokNow } from './shared.js';

const SEVERITY = { ok: 0, degraded: 1, down: 2 };
const worst = (a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a);

// อายุของ isolate ปัจจุบัน ไม่ใช่ uptime ของบริการ — Cloudflare รีไซเคิล isolate ตลอดเวลา
// ค่าน้อยไม่ได้แปลว่าเพิ่งล่ม รายงานไว้เฉยๆ เพื่อดูว่าโค้ดที่รันอยู่เพิ่งถูก deploy ใหม่หรือเปล่า
const BOOT_AT = Date.now();

// ตรวจซ้ำถี่ๆ ไม่ได้ข้อมูลใหม่ แต่ยิง LINE API เพิ่มทุกครั้ง — cache ไว้ใน isolate เท่านั้น
// (ไม่ใช้ KV/D1 เพราะ health check ต้องไม่พึ่งของที่ตัวเองกำลังตรวจ)
const LINE_INFO_CACHE_MS = 60 * 1000;
let lineInfoCache = null;

// เขียน heartbeat ถี่แค่ไหนก็ได้ แต่ไม่มีประโยชน์ — ความละเอียดระดับ 5 นาทีพอสำหรับตอบว่า
// "บอทยังทำงานอยู่ไหม" และทำให้จำนวน write ต่อวันคงที่ ไม่ผูกกับจำนวนข้อความที่คนพิมพ์เข้ามา
const HEARTBEAT_MIN_INTERVAL_MS = 5 * 60 * 1000;
const heartbeatWrittenAt = new Map();

const CHECK_LABELS = {
  config:       'ตั้งค่าระบบ',
  line_api:     'เชื่อมต่อ LINE',
  database:     'ฐานข้อมูล',
  chat_history: 'ความจำการคุย',
  ai:           'ผู้ช่วย AI',
  exam_alerts:  'แจ้งเตือนสอบ',
};

const STATUS_WORD = { ok: 'ปกติ', degraded: 'ไม่สมบูรณ์', down: 'ขัดข้อง' };
const STATUS_COLOR = { ok: FLEX_TOKENS.green, degraded: '#D98E04', down: FLEX_TOKENS.red };

// --- heartbeat -------------------------------------------------------------

// บันทึกว่าบอทประมวลผลอะไรจบไปแล้วเมื่อไหร่ เรียกได้จากทุกที่โดยไม่ต้องกลัวพัง —
// heartbeat เขียนไม่ลงไม่ใช่เหตุผลที่จะทำให้ผู้ใช้ไม่ได้รับคำตอบ จึงกลืน error ทิ้งทั้งหมด
export async function recordHeartbeat(env, kind, detail = null) {
  if (!env || !env.DB) return;

  // error ต้องบันทึกทันทีทุกครั้ง ไม่งั้นตัวแรกของเหตุการณ์จะโดน throttle กลืนไปพอดี
  const throttled = kind !== 'webhook_error';
  const now = Date.now();
  if (throttled && now - (heartbeatWrittenAt.get(kind) || 0) < HEARTBEAT_MIN_INTERVAL_MS) return;
  heartbeatWrittenAt.set(kind, now);

  try {
    await env.DB.prepare(
      `INSERT INTO bot_heartbeat (kind, last_at, detail) VALUES (?, ?, ?)
       ON CONFLICT(kind) DO UPDATE SET last_at = excluded.last_at, detail = excluded.detail`
    ).bind(kind, new Date(now).toISOString(), detail ? String(detail).slice(0, 300) : null).run();
  } catch (err) {
    console.error('heartbeat เขียนไม่สำเร็จ', kind, err);
  }
}

async function readHeartbeats(env) {
  const out = {};
  try {
    const { results } = await env.DB.prepare('SELECT kind, last_at, detail FROM bot_heartbeat').all();
    for (const r of results || []) out[r.kind] = { last_at: r.last_at, detail: r.detail };
  } catch (err) {
    console.error('อ่าน heartbeat ไม่สำเร็จ', err);
  }
  return out;
}

// --- ตัวตรวจแต่ละอย่าง ------------------------------------------------------

// ทุก check ต้องมีเพดานเวลาของตัวเอง ไม่งั้นของที่ค้าง (เช่น LINE API ไม่ตอบ) จะลาก
// health check ทั้งใบไปค้างด้วย ซึ่งทำให้ตัวที่ควรบอกว่า "มีปัญหา" กลายเป็น timeout เฉยๆ
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} ไม่ตอบใน ${ms} ms`)), ms)),
  ]);
}

async function timed(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return { name, label: CHECK_LABELS[name] || name, latency_ms: Date.now() - started, ...result };
  } catch (err) {
    return {
      name, label: CHECK_LABELS[name] || name, latency_ms: Date.now() - started,
      status: 'down', detail: String(err && err.message ? err.message : err).slice(0, 200),
    };
  }
}

// secret หายคือเคสที่ทำให้บอทเงียบสนิทมาแล้ว — เช็คก่อนใครเพราะไม่ต้องรอ I/O อะไรเลย
function checkConfig(env) {
  const missing = ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'].filter((k) => !env[k]);
  if (missing.length) {
    return { status: 'down', detail: `secret หายไป: ${missing.join(', ')} — แก้ด้วย cd worker && npm run deploy` };
  }
  if (!env.LIFF_URL) return { status: 'degraded', detail: 'ไม่มี LIFF_URL — ปุ่มเปิดแอปในการ์ดจะพาไปผิดที่' };
  return { status: 'ok', detail: 'secret ครบ' };
}

async function checkDatabase(env) {
  if (!env.DB) return { status: 'down', detail: 'ไม่มี binding DB' };
  const rowResult = await withTimeout(env.DB.prepare('SELECT 1 AS ok').first(), 5000, 'D1');
  if (!rowResult || rowResult.ok !== 1) return { status: 'down', detail: 'D1 ตอบผิดรูปแบบ' };
  return { status: 'ok', detail: 'D1 ตอบปกติ' };
}

// อ่านคีย์ที่ไม่มีอยู่จริงก็พอ — สนใจแค่ว่า KV ตอบได้ไหม ไม่ได้สนใจค่า
// ห้ามใช้ list เด็ดขาด: โควตา list คือตัวที่เคยหมดจนทำ production ล่ม (ดู README)
async function checkChatHistory(env) {
  if (!env.CHAT_HISTORY_RAM) return { status: 'degraded', detail: 'ไม่มี binding CHAT_HISTORY_RAM' };
  await withTimeout(env.CHAT_HISTORY_RAM.get('__healthcheck__'), 5000, 'KV');
  // KV ล่ม = ลืมบทสนทนาก่อนหน้า แต่ค้นตึก/ที่จอดรถ/ตารางสอบยังทำงานครบ จึงไม่ใช่ down
  return { status: 'ok', detail: 'KV อ่านได้' };
}

// ไม่ยิง inference จริงเพราะเสียเวลาและเสียโควตาทุกครั้งที่ monitor ping เข้ามา
// เช็คแค่ว่า binding มีอยู่ — AI ที่ล่มจริงๆ มี fallback ใน ai.js รออยู่แล้ว
function checkAI(env) {
  if (!env.AI || typeof env.AI.run !== 'function') {
    return { status: 'degraded', detail: 'ไม่มี binding AI — ตอบได้เฉพาะคำถามที่ match ข้อมูลตรงๆ' };
  }
  return { status: 'ok', detail: 'binding พร้อม' };
}

// /v2/bot/info ไม่นับรวมโควตาข้อความรายเดือน (ไม่ได้ส่งข้อความ) จึงใช้เช็ค token ได้ปลอดภัย
// 401 = token ใช้ไม่ได้ -> บอทตอบใครไม่ได้เลย ถือว่า down
// 5xx / เน็ตพัง = ฝั่ง LINE มีปัญหาชั่วคราว ไม่ใช่ความผิดเรา -> degraded
async function checkLineApi(env) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return { status: 'down', detail: 'ไม่มี access token' };

  if (lineInfoCache && Date.now() - lineInfoCache.at < LINE_INFO_CACHE_MS) return lineInfoCache.result;

  let result;
  try {
    const res = await withTimeout(fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    }), 5000, 'LINE API');

    if (res.ok) {
      const info = await res.json().catch(() => ({}));
      result = { status: 'ok', detail: info.displayName ? `OA: ${info.displayName}` : 'token ใช้งานได้' };
    } else if (res.status === 401 || res.status === 403) {
      result = { status: 'down', detail: `access token ใช้ไม่ได้ (${res.status}) — ออก token ใหม่แล้ว npm run deploy` };
    } else {
      result = { status: 'degraded', detail: `LINE API ตอบ ${res.status}` };
    }
  } catch (err) {
    result = { status: 'degraded', detail: `เรียก LINE API ไม่ได้: ${String(err.message || err).slice(0, 120)}` };
  }

  lineInfoCache = { at: Date.now(), result };
  return result;
}

// cron แจ้งเตือนสอบรันวันละครั้ง ถ้าเกินหนึ่งวันกว่าๆ แล้วยังไม่ขยับแปลว่า trigger หลุด
// ยังไม่เคยรันเลย = deploy ใหม่ ไม่ใช่ปัญหา — ไม่ยกธงแดงให้ตัวเองตอนเพิ่งขึ้นระบบ
function checkExamAlerts(heartbeats) {
  const last = heartbeats.cron && heartbeats.cron.last_at;
  if (!last) return { status: 'ok', detail: 'ยังไม่เคยรัน (cron รันวันละครั้ง 18:00 น.)' };

  const hours = (Date.now() - Date.parse(last)) / 3600000;
  if (!Number.isFinite(hours)) return { status: 'degraded', detail: 'เวลาที่บันทึกไว้อ่านไม่ออก' };
  if (hours > 26) return { status: 'degraded', detail: `cron ไม่ได้รันมา ${Math.round(hours)} ชม.` };
  return { status: 'ok', detail: `รันล่าสุด ${Math.round(hours)} ชม.ที่แล้ว` };
}

// --- รายงานรวม -------------------------------------------------------------

// deep = ยิง LINE API ด้วย ใช้ตอนคนถามจริงๆ ว่าบอทออนไลน์ไหม
// ค่าเริ่มต้นไม่ยิง เพราะ endpoint นี้ตั้งใจให้ monitor ping ได้ทุกนาทีโดยไม่ไปกวนใคร
export async function runHealthChecks(env, { deep = false } = {}) {
  const heartbeats = await readHeartbeats(env);

  const checks = await Promise.all([
    timed('config', async () => checkConfig(env)),
    timed('database', () => checkDatabase(env)),
    timed('chat_history', () => checkChatHistory(env)),
    timed('ai', async () => checkAI(env)),
    timed('exam_alerts', async () => checkExamAlerts(heartbeats)),
    ...(deep ? [timed('line_api', () => checkLineApi(env))] : []),
  ]);

  const status = checks.reduce((acc, c) => worst(acc, c.status), 'ok');

  return {
    status,
    online: status !== 'down',
    checked_at: new Date().toISOString(),
    deep,
    isolate_uptime_seconds: Math.round((Date.now() - BOOT_AT) / 1000),
    checks,
    last_activity: {
      webhook: heartbeats.webhook ? heartbeats.webhook.last_at : null,
      cron: heartbeats.cron ? heartbeats.cron.last_at : null,
      webhook_error: heartbeats.webhook_error || null,
    },
  };
}

// GET /api/health[?deep=1]
//
// เปิดสาธารณะโดยตั้งใจ — ต้องให้ uptime monitor ภายนอกยิงได้โดยไม่ต้องแบก token
// แลกกับการที่ผลแบบสาธารณะบอกแค่ "อะไรปกติ/ไม่ปกติ" ไม่มีข้อความ error ดิบ ไม่มีเวลาใช้งานล่าสุด
// รายละเอียดพวกนั้นบอกใบ้โครงสร้างระบบและปริมาณผู้ใช้ ต้องใส่ x-admin-token ถึงจะเห็น
export async function handleHealth(request, env) {
  const url = new URL(request.url);
  const deep = url.searchParams.get('deep') === '1';
  const isAdmin = isAdminRequest(request, env);

  const report = await runHealthChecks(env, { deep });
  const body = isAdmin ? report : {
    status: report.status,
    online: report.online,
    checked_at: report.checked_at,
    deep: report.deep,
    checks: report.checks.map(({ name, status, latency_ms }) => ({ name, status, latency_ms })),
  };

  return new Response(JSON.stringify(body), {
    // 503 เฉพาะตอน down จริง — degraded ต้องเป็น 200 ไม่งั้น monitor จะปลุกคนกลางดึก
    // เพราะ AI binding หาย ทั้งที่บอทยังตอบผู้ใช้ได้ตามปกติ
    status: report.status === 'down' ? 503 : 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// --- การ์ดในแชท ------------------------------------------------------------

function bangkokTimeText(iso) {
  const d = bangkokNow(new Date(iso).getTime());
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} น.`;
}

const HERO = {
  ok:       { text: 'ออนไลน์ ใช้งานได้ปกติ', header: FLEX_TOKENS.greenSoft, badge: 'ออนไลน์' },
  degraded: { text: 'ออนไลน์ แต่ไม่ครบทุกส่วน', header: FLEX_TOKENS.amberSoft, badge: 'บางส่วน' },
  down:     { text: 'ระบบขัดข้อง', header: FLEX_TOKENS.redSoft, badge: 'ขัดข้อง' },
};

// การ์ดตอบผู้ใช้ที่พิมพ์ "สถานะ" — บอกผลเป็นคำ ไม่ใช่ชื่อ binding หรือข้อความ error
//
// คนที่พิมพ์ถามคือนักศึกษาที่สงสัยว่า "ถามไปแล้วจะได้คำตอบไหม" ไม่ใช่คนดูแลระบบ
// รายละเอียดดิบอยู่ที่ /api/health (ต้องมี token) ตรงนี้เอาแค่พอให้ตัดสินใจได้ว่าจะใช้ต่อหรือรอ
export function statusFlexMessage(report) {
  const look = HERO[report.status] || HERO.degraded;

  const rows = report.checks
    // AI ที่ไม่มี binding ในเครื่อง dev ไม่ใช่เรื่องที่ผู้ใช้ต้องรู้ — ซ่อนเฉพาะแถวที่ปกติทั้งหมด
    // ไม่ได้ ไม่งั้นการ์ดจะว่างเปล่าตอนทุกอย่างดี จึงแสดงครบทุกแถวเสมอ
    .map((c) => row(c.label, STATUS_WORD[c.status] || c.status, {
      strong: c.status !== 'ok',
      color: STATUS_COLOR[c.status] || FLEX_TOKENS.ink,
    }));

  const note = report.status === 'ok'
    ? 'ตรวจสดทุกครั้งที่พิมพ์ถาม ไม่ได้อ่านค่าที่บันทึกไว้ล่วงหน้า'
    : 'ส่วนที่ขัดข้องกำลังได้รับการแก้ไข ระหว่างนี้ยังใช้ส่วนที่เหลือได้ตามปกติครับ';

  return resultCard({
    title: 'สถานะระบบรามรู้ทาง',
    badge: look.badge,
    headerColor: look.header,
    hero: look.text,
    heroColor: STATUS_COLOR[report.status],
    heroNote: `ตรวจเมื่อ ${bangkokTimeText(report.checked_at)} (เวลาไทย)`,
    rows,
    note,
    actions: [{ label: 'กลับเมนูหลัก', action: { type: 'message', label: 'เมนูหลัก', text: 'เมนูหลัก' } }],
    altText: `สถานะบอท: ${look.text}`,
  });
}
