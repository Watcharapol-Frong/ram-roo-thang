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

// --- STUDENT_SCHEDULES (ไม่มี PII — docs/adr/0003) ---
// Key: schedule:{user_id}:{schedule_id} — ผูกกับ LINE userId เท่านั้น ไม่มีชื่อ/เบอร์โทร

export async function putSchedule(env, userId, schedule) {
  const key = `schedule:${userId}:${schedule.schedule_id}`;
  await env.STUDENT_SCHEDULES.put(key, JSON.stringify(schedule));
}

export async function listSchedulesForUser(env, userId) {
  return listByPrefix(env.STUDENT_SCHEDULES, `schedule:${userId}:`);
}

export async function deleteSchedule(env, userId, scheduleId) {
  await env.STUDENT_SCHEDULES.delete(`schedule:${userId}:${scheduleId}`);
}
