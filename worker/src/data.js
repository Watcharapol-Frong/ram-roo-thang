// KV access: baseline data, parking reports, rate limit, exam schedule
// ดู MVP-SPEC-for-Dev.md §3 สำหรับ data model, docs/adr/0003 สำหรับ schedule (ไม่มี PII)

async function listByPrefix(kv, prefix) {
  const results = [];
  let cursor;
  let listComplete = false;

  while (!listComplete) {
    const page = await kv.list({ prefix, cursor });
    // ดึงค่าของทุก key ในหน้านี้พร้อมกัน (ไม่ await ทีละตัว) กันช้าเป็นเส้นตรงตามจำนวน key
    const values = await Promise.all(page.keys.map((key) => kv.get(key.name)));
    for (const raw of values) {
      if (raw) results.push(JSON.parse(raw));
    }
    listComplete = page.list_complete;
    cursor = page.cursor;
  }

  return results;
}

// --- BASELINE_DATA (MVP-SPEC-for-Dev.md §3.1) ---

export async function getBuildingByKey(env, buildingId) {
  const raw = await env.BASELINE_DATA.get(`building:${buildingId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function getParkingZoneByKey(env, zoneId) {
  const raw = await env.BASELINE_DATA.get(`parking_zone:${zoneId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function listBuildings(env) {
  return listByPrefix(env.BASELINE_DATA, 'building:');
}

export async function listParkingZones(env) {
  return listByPrefix(env.BASELINE_DATA, 'parking_zone:');
}

// --- shops (ร้านค้า/ซุ้ม — ข้อมูลนิ่งที่ทีมสำรวจเอง ดู data/ru_master.geojson) ---
// ต่างจาก poi ใน docs/adr/0004 ตรงที่ไม่ใช่ของที่ผู้ใช้ส่งเข้ามาเอง จึงไม่ต้องมีระบบ moderation
// (ADR-0004 ตัด "community POI" ออกเพราะยังไม่มีคนตรวจ ไม่ได้ตัดร้านค้าที่ทีมกรอกเองออกไปด้วย)

export async function listShops(env) {
  return listByPrefix(env.BASELINE_DATA, 'shop:');
}

// --- services (บริการ/ขั้นตอนราชการ — team กรอกเอง เหมือน building/parking_zone) ---
// docs/adr/0004-service-faq-vs-community-poi.md

export async function getServiceByKey(env, serviceId) {
  const raw = await env.BASELINE_DATA.get(`service:${serviceId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function listServices(env) {
  return listByPrefix(env.BASELINE_DATA, 'service:');
}

// --- PARKING_REPORTS (MVP-SPEC-for-Dev.md §3.2) ---

export async function putParkingReport(env, report, ttlSeconds) {
  const key = `report:${report.zone_id}:${report.reported_at}`;
  await env.PARKING_REPORTS.put(key, JSON.stringify(report), { expirationTtl: ttlSeconds });
}

export async function listParkingReportsForZone(env, zoneId) {
  return listByPrefix(env.PARKING_REPORTS, `report:${zoneId}:`);
}

// --- RATE_LIMIT (MVP-SPEC-for-Dev.md §3.3) ---

export async function getLastReportedAt(env, userId) {
  return env.RATE_LIMIT.get(`ratelimit:${userId}`);
}

export async function setLastReportedAt(env, userId, isoTimestamp) {
  return env.RATE_LIMIT.put(`ratelimit:${userId}`, isoTimestamp, { expirationTtl: 30 * 60 });
}

// วิชาที่ผู้ใช้บันทึกไว้ย้ายไป D1 แล้ว (ตาราง user_courses) — ดู worker/src/schedule.js
// ฟังก์ชัน putSchedule/listSchedulesForUser/deleteSchedule ที่เคยอยู่ตรงนี้ถูกลบพร้อมกับ
// KV namespace STUDENT_SCHEDULES ไม่ปล่อยไว้ให้เรียกแล้วพังเงียบๆ เพราะ binding ไม่มีอยู่จริงแล้ว
