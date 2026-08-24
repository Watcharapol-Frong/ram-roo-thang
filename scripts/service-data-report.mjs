// รายงานว่าข้อมูลบริการแต่ละเรื่องครบแค่ไหน — ใช้ติดตามความคืบหน้าของงานเก็บข้อมูล
//
// อ่านจาก data/baseline-dataset.json ผ่าน normalizeService() ตัวเดียวกับที่บอทใช้จริง
// จึงบอก "สิ่งที่บอทตอบได้จริง" ไม่ใช่ "สิ่งที่กรอกไว้ในไฟล์" — ต่างกันตรงที่ steps ก้อนเดิม
// ถูกแกะเป็นเอกสาร/ขั้นตอนให้อัตโนมัติ ช่องที่ขึ้นว่ามีจึงรวมของที่แกะได้ด้วย
//
// รัน:  node scripts/service-data-report.mjs           ตารางอ่านด้วยตา
//       node scripts/service-data-report.mjs --json    สำหรับเอาไปทำต่อ
//
// ไม่ต้องมาแก้เอกสารเช็คลิสต์ด้วยมือทุกครั้งที่เติมข้อมูล — รันอันนี้แล้วเห็นของจริงเสมอ
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { normalizeService } = await import(path.join(ROOT, 'worker/src/serviceinfo.js'));
const dataset = JSON.parse(readFileSync(path.join(ROOT, 'data/baseline-dataset.json'), 'utf8'));

// เรียงตามลำดับความสำคัญที่ตกลงกันไว้ — เอกสารกับเวลาทำการมาก่อน เพราะสองอย่างนี้
// ผิดแล้วผู้ใช้เสียเที่ยว ส่วนที่เหลือแค่ต้องกลับมาถามใหม่
const FIELDS = [
  { key: 'procedure', label: 'ขั้นตอน',      priority: 1, why: 'คำถามหลักที่คนถามต่อจาก "อยู่ที่ไหน"' },
  { key: 'documents', label: 'เอกสาร',       priority: 1, why: 'เตรียมผิด = ไปถึงแล้วทำเรื่องไม่ได้' },
  { key: 'hours',     label: 'เวลาทำการ',    priority: 1, why: 'ไปถึงแล้วปิด คือความเสียหายที่หนักที่สุด' },
  { key: 'fee',       label: 'ค่าใช้จ่าย',    priority: 2, why: 'ต้องรู้ว่าพกเงินไปเท่าไหร่' },
  { key: 'duration',  label: 'ระยะเวลา',     priority: 2, why: 'วางแผนว่าต้องมากี่รอบ' },
  { key: 'period',    label: 'ช่วงเวลายื่น',  priority: 2, why: 'บางเรื่องเปิดรับเฉพาะบางเดือน พลาดแล้วรอปีหน้า' },
  { key: 'contact',   label: 'ติดต่อ',        priority: 3, why: 'ไว้ถามต่อเองเมื่อเกินขอบเขตบอท' },
];

const filled = (value) => (Array.isArray(value) ? value.length > 0 : Boolean(value));

const rows = dataset.services.map((service) => {
  const info = normalizeService(service);
  const has = {};
  for (const f of FIELDS) has[f.key] = filled(info[f.key]);
  return {
    service_id: service.service_id,
    name: service.name,
    label: (service.aliases && service.aliases[0]) || service.service_id,
    has,
    missing: FIELDS.filter((f) => !has[f.key]).map((f) => f.key),
  };
});

const coverage = Object.fromEntries(FIELDS.map((f) => {
  const n = rows.filter((r) => r.has[f.key]).length;
  return [f.key, { filled: n, total: rows.length, percent: Math.round((n / rows.length) * 100) }];
}));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), fields: FIELDS, coverage, services: rows }, null, 2));
  process.exit(0);
}

const pad = (s, n) => {
  // ตัวอักษรไทยกว้างไม่เท่า ASCII ใน terminal — นับตามจำนวนตัวอักษรพอ ไม่ต้องเป๊ะ
  const len = [...String(s)].length;
  return String(s) + ' '.repeat(Math.max(0, n - len));
};

console.log('\nความครบของข้อมูลบริการ  (' + rows.length + ' เรื่อง)\n');
console.log(pad('service_id', 34) + FIELDS.map((f) => pad(f.label, 13)).join(''));
console.log('-'.repeat(34 + FIELDS.length * 13));
for (const r of rows) {
  console.log(pad(r.service_id, 34) + FIELDS.map((f) => pad(r.has[f.key] ? '  ครบ' : '  ขาด', 13)).join(''));
}

console.log('\nสรุปรายช่อง');
for (const f of FIELDS) {
  const c = coverage[f.key];
  const bar = '█'.repeat(Math.round(c.percent / 5)) + '░'.repeat(20 - Math.round(c.percent / 5));
  console.log(`  ${pad(f.label, 14)} ${bar} ${String(c.percent).padStart(3)}%  (${c.filled}/${c.total})  [P${f.priority}] ${f.why}`);
}

const p1 = FIELDS.filter((f) => f.priority === 1 && coverage[f.key].percent < 100);
if (p1.length) {
  console.log('\nงานที่ควรทำก่อน (P1 ที่ยังไม่ครบ)');
  for (const f of p1) {
    const missing = rows.filter((r) => !r.has[f.key]).map((r) => r.service_id);
    console.log(`  ${f.label} — ขาด ${missing.length} เรื่อง: ${missing.join(', ')}`);
  }
}
console.log('');
