// แก้ค่าด้านล่างก่อน deploy จริง (README "เริ่มงาน (Setup)")
const LIFF_ID = 'REPLACE_ME_LIFF_ID';
const WORKER_BASE_URL = 'REPLACE_ME_WORKER_BASE_URL'; // เช่น https://ram-roo-thang-bot.<subdomain>.workers.dev
const GOOGLE_MAPS_API_KEY = 'REPLACE_ME_GOOGLE_MAPS_API_KEY';

const CONSENT_STORAGE_KEY = 'ram-roo-thang:schedule-consent';

liff.init({ liffId: LIFF_ID }).then(main).catch((err) => {
  console.error('LIFF init error', err);
  renderError('เปิด LIFF ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
});

function main() {
  const params = new URLSearchParams(window.location.search);

  if (params.has('dest_id')) {
    renderNavigationView(params.get('dest_id'));
  } else if (params.get('mode') === 'profile') {
    renderProfileView();
  } else {
    renderParkingReportView();
  }
}

function renderError(message) {
  document.getElementById('app').innerHTML = `<p>${message}</p>`;
}

// Navigation view (MVP-SPEC §7) — TODO:
//   1. navigator.geolocation.getCurrentPosition() หาตำแหน่ง user
//      - ปฏิเสธ permission -> แสดงข้อความขอ location ใหม่ + ปุ่มลองอีกครั้ง (ไม่มี manual pin fallback)
//   2. GET `${WORKER_BASE_URL}/api/building?building_id=${destId}` หาพิกัดตึกปลายทาง
//   3. Embed Google Maps mode=directions: origin=user, destination=พิกัดตึก, mode=walking
//      (ใช้ GOOGLE_MAPS_API_KEY)
function renderNavigationView(destId) {
  document.getElementById('app').innerHTML = `<p>Navigation view — ยังไม่ implement (dest_id=${destId})</p>`;
}

// Parking report view (MVP-SPEC §7) — TODO:
//   1. geolocation หาตำแหน่ง user
//   2. GET `${WORKER_BASE_URL}/api/buildings` หาลานจอดที่ใกล้ที่สุดจาก BASELINE_DATA
//   3. ปุ่มเลือกสถานะ (ว่าง/ปานกลาง/เต็ม) -> POST `${WORKER_BASE_URL}/api/parking/report`
//   4. แสดงผลลัพธ์ (สำเร็จ / ไกลเกิน 422 / รายงานถี่เกิน 429)
function renderParkingReportView() {
  document.getElementById('app').innerHTML = '<p>Parking report view — ยังไม่ implement</p>';
}

// Profile view (MVP-SPEC §7, docs/adr/0003) — TODO:
//   1. Consent gate เบื้องต้น — เช็ค localStorage[CONSENT_STORAGE_KEY] ก่อนแสดงฟอร์ม
//      (UI acknowledgment เฉยๆ ไม่ใช่ PDPA flow ตามกฎหมาย เพราะไม่มี PII — CONTEXT.md "Consent Gate (Lightweight)")
//   2. ฟอร์มกรอกรหัสวิชา + เลือกอาคาร (dropdown จาก GET /api/buildings) + วันเวลาสอบ -> POST /api/schedule
//   3. ลิสต์วิชาที่บันทึกไว้ (GET /api/schedule?user_id=) พร้อมปุ่มลบ (DELETE /api/schedule)
function renderProfileView() {
  const hasConsent = localStorage.getItem(CONSENT_STORAGE_KEY) === 'true';
  document.getElementById('app').innerHTML = hasConsent
    ? '<p>Profile view (บันทึกวิชาสอบ) — ยังไม่ implement</p>'
    : '<p>Consent gate — ยังไม่ implement</p>';
}
