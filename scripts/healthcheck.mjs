// เช็คว่าบอทออนไลน์ไหมจากนอกระบบ — ยิง /api/health แล้วสรุปเป็นภาษาคน
//
// ต้องยิงจากข้างนอกเท่านั้นถึงจะเชื่อได้: ถ้าตัว worker ตายหรือ DNS/route พัง โค้ดที่รันอยู่
// ข้างในไม่มีทางบอกอะไรเราได้เลย สคริปต์นี้จึงคุยกับ production ผ่าน HTTP จริงเสมอ
//
// รัน:
//   node scripts/healthcheck.mjs                     เช็คเร็ว (ไม่แตะ LINE API)
//   node scripts/healthcheck.mjs --deep              เช็ค access token ของ LINE ด้วย
//   node scripts/healthcheck.mjs --deep --token=xxx  เห็นสาเหตุแบบเต็ม + เวลาใช้งานล่าสุด
//   node scripts/healthcheck.mjs --watch=60          เช็คซ้ำทุก 60 วินาที
//   node scripts/healthcheck.mjs --url=http://localhost:8787
//
// exit code ออกแบบให้ต่อกับ cron/CI ได้ตรงๆ:  0 = ปกติ, 1 = ไม่สมบูรณ์, 2 = ขัดข้อง/ติดต่อไม่ได้
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));

const BASE = (args.url || 'https://ram-roo-thang-bot.frongbook.workers.dev').replace(/\/$/, '');
const TOKEN = args.token || process.env.ADMIN_TOKEN || '';
const WATCH = args.watch ? Number(args.watch) : 0;

const WORD = { ok: 'ปกติ', degraded: 'ไม่สมบูรณ์', down: 'ขัดข้อง' };
const MARK = { ok: '✅', degraded: '⚠️ ', down: '❌' };
const EXIT = { ok: 0, degraded: 1, down: 2 };

function thaiTime(iso) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  return d.toISOString().slice(11, 19).concat(' น.');
}

function since(iso) {
  if (!iso) return 'ยังไม่เคย';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'เมื่อครู่นี้';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} ชม.ที่แล้ว`;
  return `${Math.round(mins / 1440)} วันที่แล้ว`;
}

async function once() {
  const url = `${BASE}/api/health${args.deep ? '?deep=1' : ''}`;
  const started = Date.now();

  let res, report;
  try {
    res = await fetch(url, { headers: TOKEN ? { 'x-admin-token': TOKEN } : {} });
    report = await res.json();
  } catch (err) {
    // ติดต่อไม่ได้เลยคือเคสที่แย่ที่สุด และเป็นเคสเดียวที่ /api/health รายงานตัวเองไม่ได้
    console.log(`❌ ติดต่อ ${BASE} ไม่ได้เลย — ${err.message}`);
    return 2;
  }
  const rtt = Date.now() - started;

  if (!report || !report.status) {
    console.log(`❌ ${BASE} ตอบ HTTP ${res.status} แต่ไม่ใช่รายงานสถานะ — เช็คว่า route /api/health ถูก deploy แล้วหรือยัง`);
    return 2;
  }

  console.log(`\n${MARK[report.status]} บอท${report.status === 'down' ? 'ขัดข้อง' : 'ออนไลน์'} — สรุป: ${WORD[report.status]}`);
  console.log(`   ${BASE}  |  HTTP ${res.status}  |  ตอบใน ${rtt} ms  |  ตรวจเมื่อ ${thaiTime(report.checked_at)}`);
  if (!report.deep) console.log('   (ยังไม่ได้เช็ค access token ของ LINE — ใส่ --deep ถ้าต้องการ)');
  console.log('');

  for (const c of report.checks || []) {
    const label = (c.label || c.name).padEnd(16);
    const detail = c.detail ? `  ${c.detail}` : '';
    console.log(`   ${MARK[c.status]} ${label} ${WORD[c.status].padEnd(10)} ${String(c.latency_ms).padStart(5)} ms${detail}`);
  }

  // มีเฉพาะตอนใส่ x-admin-token — ส่วนที่บอกว่าบอท "ทำงานจริง" ครั้งล่าสุดเมื่อไหร่
  if (report.last_activity) {
    console.log('');
    console.log(`   ตอบแชทล่าสุด    ${since(report.last_activity.webhook)}`);
    console.log(`   cron รันล่าสุด   ${since(report.last_activity.cron)}`);
    if (report.last_activity.webhook_error) {
      const e = report.last_activity.webhook_error;
      console.log(`   ⚠️  ประมวลผล event พลาดล่าสุด ${since(e.last_at)}: ${e.detail || '(ไม่มีรายละเอียด)'}`);
    }
  }

  return EXIT[report.status] ?? 2;
}

if (!WATCH) {
  process.exit(await once());
}

console.log(`เช็คทุก ${WATCH} วินาที (Ctrl+C เพื่อหยุด)`);
while (true) {
  await once();
  await new Promise((r) => setTimeout(r, WATCH * 1000));
}
