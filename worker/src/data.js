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

// --- parking_reports (D1, migration 0011) ---
//
// ย้ายมาจาก KV ที่เก็บคีย์เดียวต่อลาน (`latest:{zone_id}`) แล้วเขียนทับทุกครั้ง — เหตุผลเดียวกับที่
// README เขียนไว้เรื่อง "ทำไม user data ถึงอยู่บน D1": KV เขียนแบบ read-modify-write จึงเสียรายงาน
// เมื่อมีคนกดพร้อมกัน, query ไม่ได้จึงดูได้แค่ใบล่าสุดใบเดียว, และการอ่านหลายใบต้องใช้ list
// ซึ่งเป็นโควตาที่เคยทำ production ล่มมาแล้ว ส่วน D1 insert เป็น atomic และอ่านด้วย query ปกติ
//
// ไม่มี TTL แบบ KV แล้ว — "รายงานหมดอายุ" กลายเป็นเงื่อนไข WHERE reported_at > cutoff แทน
// ซึ่งตรงกว่าเพราะกรอบเวลารวมผลเป็นเรื่องของการคิดสถานะ ไม่ใช่เรื่องของการเก็บข้อมูล
export async function insertParkingReport(env, { zone_id, status, reporter_user_id, reported_at }) {
  const res = await env.DB.prepare(
    'INSERT INTO parking_reports (zone_id, status, reporter_user_id, reported_at) VALUES (?, ?, ?, ?)'
  ).bind(zone_id, status, reporter_user_id, reported_at).run();
  return res.meta ? res.meta.last_row_id : null;
}

// รายงานทั้งหมดในกรอบเวลา เรียงใหม่สุดก่อน — ไม่ใส่ zoneId = เอาทุกลานในคำถามเดียว
// (หน้าแผนที่เรียกครั้งเดียวได้ทุกลาน ไม่ต้องยิงทีละลานเหมือนตอนอยู่บน KV)
export async function listRecentParkingReports(env, sinceIso, zoneId) {
  const sql = zoneId
    ? 'SELECT id, zone_id, status, reporter_user_id, reported_at FROM parking_reports WHERE reported_at > ? AND zone_id = ? ORDER BY reported_at DESC'
    : 'SELECT id, zone_id, status, reporter_user_id, reported_at FROM parking_reports WHERE reported_at > ? ORDER BY reported_at DESC';
  const stmt = zoneId
    ? env.DB.prepare(sql).bind(sinceIso, zoneId)
    : env.DB.prepare(sql).bind(sinceIso);
  const { results } = await stmt.all();
  return results || [];
}

// รายงานล่าสุดของลานนี้ที่ "คนอื่น" เป็นคนรายงาน — ใช้ตัดสินโบนัสความแม่น
export async function getLatestOtherReport(env, zoneId, excludeUserId, sinceIso) {
  return env.DB.prepare(
    `SELECT id, status, reporter_user_id, reported_at FROM parking_reports
      WHERE zone_id = ? AND reporter_user_id != ? AND reported_at > ?
      ORDER BY reported_at DESC LIMIT 1`
  ).bind(zoneId, excludeUserId, sinceIso).first();
}

// ลบรายงานเก่าทิ้ง เรียกจาก cron รายวัน — เก็บไว้นานกว่ากรอบเวลารวมผลมาก เพราะประวัติย้อนหลัง
// คือวัตถุดิบของ baseline ตามช่วงเวลาในอนาคต ถ้าลบทุก 30 นาทีจะไม่เหลืออะไรให้ทำ
export async function deleteOldParkingReports(env, cutoffIso) {
  const res = await env.DB.prepare('DELETE FROM parking_reports WHERE reported_at < ?').bind(cutoffIso).run();
  return res.meta ? res.meta.changes : 0;
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
