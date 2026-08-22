// test-module1-readiness.mjs
// รันจาก root ของ repo: node test-module1-readiness.mjs
//
// import findByAlias/maskPII ตรงจาก worker/src/ai.js (โค้ด production จริง) แทนการ
// เขียน logic ซ้ำในไฟล์ทดสอบ — ผลของ entity matching / PII masking จึงตรงกับที่ deploy จริง
// เป๊ะ ไม่ใช่แค่ "พฤติกรรมคล้ายกัน" เหมือนเวอร์ชันก่อนหน้า
//
// ข้อยกเว้น: parseIntent() ด้านล่างยังเป็น test-only helper เพราะ production (worker/src/line.js)
// ไม่มีฟังก์ชัน "จำแนก intent" แบบรวมศูนย์ตัวเดียว — เป็น regex แยกจุดคนละที่ (schedule shortcut,
// เช็คคำว่า parking เพื่อเลือก URL, mock fallback) parseIntent() นี้จำลองผลลัพธ์รวมไว้ให้ทดสอบง่ายๆ เท่านั้น

import { findByAlias, maskPII } from './worker/src/ai.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const datasetPath = path.join(__dirname, 'data', 'baseline-dataset.json');
let BASELINE_DATA;
try {
  BASELINE_DATA = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
} catch (err) {
  console.error('❌ ไม่พบไฟล์ data/baseline-dataset.json กรุณาตรวจสอบ path');
  process.exit(1);
}

// entity matching — เรียก findByAlias() จริงจาก ai.js ตรงๆ (normalize แบบเดียวกับ retrieveContext())
function getBuildingInfo(query) {
  if (!query) return null;
  return findByAlias(BASELINE_DATA.buildings, query.toUpperCase());
}

// Fast-Path Intent Router — test-only approximation ของพฤติกรรมรวมใน line.js (ดูหมายเหตุด้านบน)
function parseIntent(text) {
  const clean = text.trim();
  if (/^(บันทึกวิชาสอบ|ตารางสอบ|เพิ่มวิชาสอบ)$/i.test(clean)) {
    return { intent: 'SCHEDULE_DIRECT_SHORTCUT', bypass_ai: true, mode: 'profile' };
  }
  if (/(จอดรถ|ลานจอด|ที่จอด)/i.test(clean)) {
    return { intent: 'PARKING_QUERY', bypass_ai: false };
  }

  const matchedBuilding = getBuildingInfo(clean);
  if (matchedBuilding || /(ตึก|อาคาร|ห้องสอบ|ไป|ทางไป|อยู่ไหน|แถวไหน)/i.test(clean)) {
    return { intent: 'NAVIGATION_REQUEST', bypass_ai: false };
  }

  return { intent: 'GENERAL_CHAT', bypass_ai: false };
}

// ชุดข้อมูลทดสอบ 30 Test Cases
const testCases = [
  // หมวด A: ค้นหาอาคาร นำทาง และ Aliases (10 ข้อ)
  { id: 'A01', input: 'ตึกกงไปทางไหน', expectedIntent: 'NAVIGATION_REQUEST', expectedEntity: 'KLB' },
  { id: 'A02', input: 'ขอพิกัดตึก VP หน่อย', expectedIntent: 'NAVIGATION_REQUEST', expectedEntity: 'VPB' },
  { id: 'A03', input: 'ตึกส้มอยู่ตรงไหนครับ', expectedIntent: 'NAVIGATION_REQUEST', expectedEntity: 'SBB' },
  { id: 'A04', input: 'ไปอาคารนพมาศ', expectedIntent: 'NAVIGATION_REQUEST', expectedEntity: 'NMB' },
  { id: 'A05', input: 'ตึกวิศวะอยู่ไหน', expectedIntent: 'NAVIGATION_REQUEST', expectedEntity: 'VKB' },
  { id: 'A06', input: 'อาคารพ่อขุนฯ เดินไปยังไง', expectedIntent: 'NAVIGATION_REQUEST', expectedEntity: 'KRA' },
  { id: 'A07', input: 'ห้องสอบอาคารเวียงผา', expectedIntent: 'NAVIGATION_REQUEST', expectedEntity: 'VPB' },
  { id: 'A08', input: 'กบล', expectedIntent: 'NAVIGATION_REQUEST', expectedEntity: 'KLB' },
  { id: 'A09', input: 'จะไปตึกศิลาบาตร', expectedIntent: 'NAVIGATION_REQUEST', expectedEntity: 'SBB' },
  { id: 'A10', input: 'หอสมุดกลาง อยู่แถวไหน', expectedIntent: 'NAVIGATION_REQUEST', expectedEntity: 'LIB' },

  // หมวด B: สอบถามที่จอดรถ (8 ข้อ)
  { id: 'B01', input: 'ที่จอดรถตึกกงเต็มยัง', expectedIntent: 'PARKING_QUERY', expectedEntity: 'KLB' },
  { id: 'B02', input: 'ลานจอดอาคารนพมาศว่างไหม', expectedIntent: 'PARKING_QUERY', expectedEntity: 'NMB' },
  { id: 'B03', input: 'หาที่จอดรถใกล้ตึกวิศวะ', expectedIntent: 'PARKING_QUERY', expectedEntity: 'VKB' },
  { id: 'B04', input: 'ลานจอดหน้าอาคารพ่อขุน', expectedIntent: 'PARKING_QUERY', expectedEntity: 'KRA' },
  { id: 'B05', input: 'มีที่จอดรถแถวตึกเวียงผาไหม', expectedIntent: 'PARKING_QUERY', expectedEntity: 'VPB' },
  { id: 'B06', input: 'สถานะลานจอดรถตอนนี้', expectedIntent: 'PARKING_QUERY', expectedEntity: null },
  { id: 'B07', input: 'ลานจอด สวป เป็นไงบ้าง', expectedIntent: 'PARKING_QUERY', expectedEntity: 'AOB' },
  { id: 'B08', input: 'ที่จอดรถ ม.ราม เต็มหรือยัง', expectedIntent: 'PARKING_QUERY', expectedEntity: null },

  // หมวด C: ทางลัดตารางสอบ และ Intent ข้าม AI (4 ข้อ)
  { id: 'C01', input: 'บันทึกวิชาสอบ', expectedIntent: 'SCHEDULE_DIRECT_SHORTCUT', bypassExpected: true },
  { id: 'C02', input: 'ตารางสอบ', expectedIntent: 'SCHEDULE_DIRECT_SHORTCUT', bypassExpected: true },
  { id: 'C03', input: 'เพิ่มวิชาสอบ', expectedIntent: 'SCHEDULE_DIRECT_SHORTCUT', bypassExpected: true },
  { id: 'C04', input: 'สวัสดีครับ', expectedIntent: 'GENERAL_CHAT', bypassExpected: false },

  // หมวด D: PII Masking และความปลอดภัย (4 ข้อ)
  { id: 'D01', input: 'ผมรหัส 6501234567 จะไปสอบตึกกง', expectedMask: '[STUDENT_ID]', expectedEntity: 'KLB' },
  { id: 'D02', input: 'โทร 0812345678 ถามเรื่องตึก VP', expectedMask: '[PHONE_NUMBER]', expectedEntity: 'VPB' },
  { id: 'D03', input: 'เบอร์ 02-310-8000 ติดต่อตึกพ่อขุน', expectedMask: '[PHONE_NUMBER]', expectedEntity: 'KRA' },
  { id: 'D04', input: 'เลขประจำตัวประชาชน 1103700123456 ลานจอดส้ม', expectedMask: '[NATIONAL_ID]', expectedEntity: 'SBB' },

  // หมวด E: ข้อความกำกวม และ Out-of-Scope (4 ข้อ)
  { id: 'E01', input: 'ข้าวมันไก่อร่อยไหม', expectedIntent: 'GENERAL_CHAT', expectedEntity: null },
  { id: 'E02', input: 'วันนี้ฝนจะตกไหม', expectedIntent: 'GENERAL_CHAT', expectedEntity: null },
  { id: 'E03', input: 'ตึก XYZ123', expectedIntent: 'NAVIGATION_REQUEST', expectedEntity: null },
  { id: 'E04', input: 'ขอบคุณครับ', expectedIntent: 'GENERAL_CHAT', expectedEntity: null }
];

console.log('====================================================');
console.log(`🚀 กำลังทดสอบกับ Dataset จริง: อาคาร ${BASELINE_DATA.buildings.length} แห่ง | ลานจอด ${BASELINE_DATA.parking_zones.length} แห่ง`);
console.log('   entity matching + PII masking: import ตรงจาก worker/src/ai.js');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

testCases.forEach((tc) => {
  const maskedText = maskPII(tc.input);
  const parsed = parseIntent(maskedText);
  const matchedBuilding = getBuildingInfo(maskedText);

  let isPass = true;
  let failReasons = [];

  if (tc.expectedIntent && parsed.intent !== tc.expectedIntent) {
    isPass = false;
    failReasons.push(`Intent ไม่ตรง (ได้: ${parsed.intent}, คาดหวัง: ${tc.expectedIntent})`);
  }

  if (tc.bypassExpected !== undefined && parsed.bypass_ai !== tc.bypassExpected) {
    isPass = false;
    failReasons.push(`Bypass AI ไม่ตรง (ได้: ${parsed.bypass_ai}, คาดหวัง: ${tc.bypassExpected})`);
  }

  if (tc.expectedEntity !== undefined) {
    const actualEntity = matchedBuilding ? matchedBuilding.building_id : null;
    if (actualEntity !== tc.expectedEntity) {
      isPass = false;
      failReasons.push(`Entity ไม่ตรง (ได้: ${actualEntity}, คาดหวัง: ${tc.expectedEntity})`);
    }
  }

  if (tc.expectedMask && !maskedText.includes(tc.expectedMask)) {
    isPass = false;
    failReasons.push(`PII Masking ล้มเหลว (ผลลัพธ์: ${maskedText})`);
  }

  if (isPass) {
    passed++;
    console.log(`✅ [PASS] ${tc.id}: "${tc.input}" -> Intent: ${parsed.intent}${matchedBuilding ? ' | Target: ' + matchedBuilding.building_id : ''}`);
  } else {
    failed++;
    console.log(`❌ [FAIL] ${tc.id}: "${tc.input}"`);
    failReasons.forEach(r => console.log(`    ⚠️  ${r}`));
  }
});

console.log('\n====================================================');
console.log(`📊 ผลลัพธ์: ผ่าน ${passed}/${testCases.length} (${((passed / testCases.length) * 100).toFixed(1)}%) | ล้มเหลว ${failed}`);
console.log('====================================================');
