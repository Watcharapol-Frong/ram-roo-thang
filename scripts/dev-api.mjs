// Backend สำหรับพัฒนา LIFF ในเครื่อง — zero dependency (ใช้แค่ node)
//
// รัน worker/src/index.js "ตัวจริง" (router + handler เดิมทั้งหมด ไม่ได้เขียน mock ใหม่)
// โดยสลับ Cloudflare KV เป็น Map ในหน่วยความจำที่ seed จาก data/baseline-dataset.json
// ทำให้ลองกดใน LIFF ได้ครบทั้ง flow โดยไม่แตะ KV ของ production และไม่ต้องมี wrangler/บัญชี Cloudflare
//
// รัน:  node scripts/dev-api.mjs [port]        (ดีฟอลต์ 8787)
// ใช้:  http://localhost:8123/?dev=1&api=http://localhost:8787
//
// ข้อจำกัดที่ตั้งใจ: ข้อมูลอยู่ในหน่วยความจำ หายเมื่อปิดโปรเซส และ /webhook (LINE + Workers AI)
// ใช้ไม่ได้ที่นี่ — สคริปต์นี้มีไว้สำหรับงานฝั่ง LIFF ซึ่งเรียกเฉพาะ /api/* เท่านั้น

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.argv[2] || 8787);

const worker = (await import(path.join(ROOT_DIR, 'worker/src/index.js'))).default;
const dataset = JSON.parse(readFileSync(path.join(ROOT_DIR, 'data/baseline-dataset.json'), 'utf8'));

// KV จำลอง — รองรับเฉพาะ get/put/delete/list เท่าที่ worker/src/data.js เรียกใช้จริง
function createKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = '', cursor } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}

// D1 จำลอง — ใช้ node:sqlite (มีมากับ Node 22.5+) รัน SQL จริงตาม migrations ตัวเดียวกับ production
// ไม่ได้ mock ผลลัพธ์ ดังนั้น UNIQUE constraint ที่ใช้กันรับเหรียญซ้ำก็ถูกทดสอบจริงในเครื่องด้วย
function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(path.join(ROOT_DIR, 'worker/migrations/0001_users_and_coin_ledger.sql'), 'utf8'));

  const wrap = (sql, params = []) => ({
    bind: (...args) => wrap(sql, args),
    async run() {
      const info = db.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
    async first() {
      return db.prepare(sql).get(...params) ?? null;
    },
    async all() {
      return { success: true, results: db.prepare(sql).all(...params) };
    },
    __exec() {
      return db.prepare(sql).run(...params);
    },
  });

  return {
    prepare: (sql) => wrap(sql),
    // D1 รัน batch เป็นทรานแซกชันเดียว — ถ้าตัวใดตัวหนึ่งพังต้อง rollback ทั้งชุด
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = statements.map((st) => st.__exec());
        db.exec('COMMIT');
        return out.map((info) => ({ success: true, meta: { changes: Number(info.changes) } }));
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

const baseline = {};
for (const b of dataset.buildings) baseline[`building:${b.building_id}`] = JSON.stringify(b);
for (const z of dataset.parking_zones) baseline[`parking_zone:${z.zone_id}`] = JSON.stringify(z);
for (const s of dataset.services) baseline[`service:${s.service_id}`] = JSON.stringify(s);
for (const sh of dataset.shops || []) baseline[`shop:${sh.shop_id}`] = JSON.stringify(sh);

// ตารางสอบตัวอย่างของ DEV_USER ย้ายไป seed ใน D1 ด้านล่างแทน (ของเดิมเป็นคีย์แบบ KV ใช้ไม่ได้แล้ว)
const DEMO_COURSES = ['RAM1101', 'MGT1001', 'LAW1001', 'ECO1003', 'COS1101',
                      'THA1001', 'ACC1101', 'POL1100', 'RAM1000', 'ENG1001'];

const env = {
  BASELINE_DATA: createKV(baseline),
  PARKING_REPORTS: createKV(),
  RATE_LIMIT: createKV(),
  DB: createD1(),
  CHAT_HISTORY_RAM: createKV(),
  LIFF_URL: `http://localhost:8123/?dev=1&api=http://localhost:${port}`,
};
const ctx = { waitUntil: () => {} };

// seed วิชาตัวอย่างให้ DEV_USER — ผ่าน handler จริง ไม่ได้ยัด SQL ตรง จะได้เจอถ้า handler พัง
for (const code of DEMO_COURSES) {
  await worker.fetch(
    new Request(`http://localhost:${port}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'DEV_USER', course_code: code }),
    }),
    env,
    ctx
  );
}

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;

  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });

  try {
    const response = await worker.fetch(request, env, ctx);
    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(body);
    console.log(`${response.status} ${req.method} ${req.url}`);
  } catch (error) {
    console.error(`500 ${req.method} ${req.url}`, error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Internal Server Error');
  }
}).listen(port, () => {
  console.log(`LIFF dev API: http://localhost:${port} (KV ในหน่วยความจำ, ${dataset.buildings.length} อาคาร / ${dataset.parking_zones.length} ลานจอด)`);
});
