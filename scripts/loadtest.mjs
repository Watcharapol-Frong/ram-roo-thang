// จำลองผู้ใช้ 200 คนทำ journey เต็มบน production
//
// journey ต่อคน = เปิดแอป -> ดูแผนที่ -> เปิดโปรไฟล์ -> เพิ่มวิชา 3 ตัว -> ดูร้านค้า
// ผู้ใช้ทดสอบใช้ชื่อขึ้นต้น LOADTEST_ เพื่อลบทิ้งทีเดียวหลังจบ
const API = 'https://ram-roo-thang-bot.frongbook.workers.dev';
const USERS = Number(process.argv[2] || 200);
const CONCURRENCY = Number(process.argv[3] || 40);
const COURSES = ['RAM1101','MGT1001','LAW1001','ECO1003','COS1101','THA1001','ACC1101','POL1100'];

const samples = [];
async function hit(label, path, init) {
  const t = Date.now();
  try {
    const res = await fetch(API + path, init);
    const ms = Date.now() - t;
    await res.arrayBuffer();
    samples.push({ label, ms, status: res.status, ok: res.ok });
    return res.ok;
  } catch (err) {
    samples.push({ label, ms: Date.now() - t, status: 0, ok: false, err: String(err).slice(0, 60) });
    return false;
  }
}

async function journey(i) {
  const uid = `LOADTEST_${process.pid}_${i}`;
  const json = (b) => ({ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) });
  await hit('GET /api/user',           `/api/user?user_id=${uid}`);
  await Promise.all([
    hit('GET /api/buildings',      '/api/buildings'),
    hit('GET /api/parking/zones',  '/api/parking/zones'),
    hit('GET /api/shops',          '/api/shops'),
  ]);
  await hit('GET /api/schedule',   `/api/schedule?user_id=${uid}`);
  for (let c = 0; c < 3; c++) {
    await hit('POST /api/schedule', '/api/schedule', json({ user_id: uid, course_code: COURSES[(i + c) % COURSES.length] }));
  }
  await hit('POST /api/user/feedback', '/api/user/feedback', json({ user_id: uid }));
  await hit('GET /api/shop/items',  `/api/shop/items?user_id=${uid}`);
  await hit('POST /api/shop/redeem', '/api/shop/redeem', json({ user_id: uid, item_id: 'STICKER_LINE_01' }));
}

const started = Date.now();
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (true) {
    const i = next++;
    if (i >= USERS) return;
    await journey(i);
  }
}));
const wall = (Date.now() - started) / 1000;

const pct = (arr, p) => arr.length ? arr.slice().sort((a,b)=>a-b)[Math.min(arr.length-1, Math.floor(arr.length*p))] : 0;
const byLabel = {};
for (const s of samples) (byLabel[s.label] ??= []).push(s);

console.log(`\nผู้ใช้ ${USERS} คน | ยิงพร้อมกันสูงสุด ${CONCURRENCY} | ใช้เวลารวม ${wall.toFixed(1)} วิ`);
console.log(`คำขอทั้งหมด ${samples.length} | ${(samples.length/wall).toFixed(1)} req/s\n`);
console.log('endpoint'.padEnd(26), 'จำนวน'.padStart(6), 'p50'.padStart(7), 'p95'.padStart(7), 'สูงสุด'.padStart(8), '  พลาด');
for (const [label, list] of Object.entries(byLabel)) {
  const ms = list.map(x=>x.ms);
  const fail = list.filter(x=>!x.ok);
  const codes = [...new Set(fail.map(f=>f.status||f.err))].slice(0,2).join(',');
  console.log(label.padEnd(26), String(list.length).padStart(6),
    (pct(ms,.5)+'ms').padStart(7), (pct(ms,.95)+'ms').padStart(7), (Math.max(...ms)+'ms').padStart(8),
    '  '+(fail.length ? `${fail.length} (${codes})` : '0'));
}
const failed = samples.filter(s=>!s.ok);
console.log(`\nรวมพลาด ${failed.length}/${samples.length} (${(failed.length/samples.length*100).toFixed(2)}%)`);
