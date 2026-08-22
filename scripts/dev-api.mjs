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

const baseline = {};
for (const b of dataset.buildings) baseline[`building:${b.building_id}`] = JSON.stringify(b);
for (const z of dataset.parking_zones) baseline[`parking_zone:${z.zone_id}`] = JSON.stringify(z);
for (const s of dataset.services) baseline[`service:${s.service_id}`] = JSON.stringify(s);

const env = {
  BASELINE_DATA: createKV(baseline),
  PARKING_REPORTS: createKV(),
  RATE_LIMIT: createKV(),
  STUDENT_SCHEDULES: createKV(),
  CHAT_HISTORY_RAM: createKV(),
  LIFF_URL: `http://localhost:8123/?dev=1&api=http://localhost:${port}`,
};
const ctx = { waitUntil: () => {} };

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
