// การเข้าถึงข้อมูล
//
// ข้อมูลอ้างอิง (อาคาร ลานจอด บริการ ร้านค้า) ไม่ได้อยู่ใน KV แล้ว — bundle เข้า worker ตรงๆ
//
// เหตุผล: มันเป็นข้อมูลอ่านอย่างเดียวที่แทบไม่เปลี่ยนทั้งภาคเรียน แต่เดิมทุกครั้งที่เปิดแผนที่
// ต้องยิง KV list + get รวมกันเกือบ 80 ครั้ง ซึ่ง "list" ของ KV กินโควตาคนละก้อนกับ read ธรรมดา
// และหมดเร็วมาก — 24 ส.ค. 2026 โควตา list รายวันหมดตอนบ่าย ทำให้ทุก endpoint ที่อ่านข้อมูล
// อ้างอิงตอบ 500 ทั้งหมด บอทตอบว่าไม่มีข้อมูลอาคารทั้งที่ข้อมูลอยู่ครบ
//
// bundle แล้วได้ทั้งความเร็ว (ไม่มี network hop) ความเสถียร (ไม่มีโควตาให้หมด) และค่าใช้จ่าย 0
// แลกกับการต้อง deploy ใหม่เมื่อแก้ข้อมูล ซึ่งรับได้เพราะข้อมูลชุดนี้นานๆ เปลี่ยนที
//
// KV ยังใช้กับของที่เปลี่ยนตลอดและต้องหมดอายุเอง: PARKING_REPORTS, RATE_LIMIT, CHAT_HISTORY_RAM

import dataset from '../../data/baseline-dataset.json' with { type: 'json' };

const BUILDINGS = dataset.buildings || [];
const PARKING_ZONES = dataset.parking_zones || [];
const SERVICES = dataset.services || [];
const SHOPS = dataset.shops || [];

const byId = (list, key) => new Map(list.map((item) => [item[key], item]));
const BUILDING_BY_ID = byId(BUILDINGS, 'building_id');
const ZONE_BY_ID = byId(PARKING_ZONES, 'zone_id');
const SERVICE_BY_ID = byId(SERVICES, 'service_id');

export async function listBuildings() { return BUILDINGS; }
export async function listParkingZones() { return PARKING_ZONES; }
export async function listServices() { return SERVICES; }
export async function listShops() { return SHOPS; }

export async function getBuildingByKey(env, buildingId) {
  return BUILDING_BY_ID.get(buildingId) || null;
}
export async function getParkingZoneByKey(env, zoneId) {
  return ZONE_BY_ID.get(zoneId) || null;
}
export async function getServiceByKey(env, serviceId) {
  return SERVICE_BY_ID.get(serviceId) || null;
}

// --- PARKING_REPORTS ---
//
// เก็บ "รายงานล่าสุดของแต่ละลาน" คีย์เดียวต่อลาน ไม่ใช่คีย์ละหนึ่งรายงาน
// เพราะการคิดสถานะใช้แค่รายงานล่าสุดในกรอบเวลาเท่านั้น เก็บทีละใบแล้วต้อง list ทุกครั้งที่
// มีคนเปิดแผนที่ ซึ่งเปลืองโควตาที่หมดง่ายที่สุดของ KV โดยไม่ได้ใช้ข้อมูลที่ list มาเลยนอกจากใบล่าสุด
//
// TTL = กรอบเวลารวมผล พอหมดอายุก็กลับไปใช้ baseline เองโดยไม่ต้องกรองวันที่ในโค้ด
export async function putParkingReport(env, report, ttlSeconds) {
  await env.PARKING_REPORTS.put(`latest:${report.zone_id}`, JSON.stringify(report), { expirationTtl: ttlSeconds });
}

export async function getLatestParkingReport(env, zoneId) {
  const raw = await env.PARKING_REPORTS.get(`latest:${zoneId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
