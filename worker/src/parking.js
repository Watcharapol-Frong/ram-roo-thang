// POST /api/parking/report, GET /api/parking/status
// MVP-SPEC-for-Dev.md §5 (Aggregation Window), §6.1-6.2
// CONTEXT.md "Parking Check-in (Crowdsourced Report)", "Geofence Validation", "Aggregation Window"

import { haversineDistanceMeters } from './utils.js';
import {
  getParkingZoneByKey,
  listParkingZones,
  putParkingReport,
  listParkingReportsForZone,
  getLastReportedAt,
  setLastReportedAt,
} from './data.js';
import { awardParkingReport } from './user.js';

const RATE_LIMIT_MINUTES = 30;
const GEOFENCE_RADIUS_METERS = 150;
const AGGREGATION_WINDOW_MINUTES = 30;
// รายงานที่พ้น aggregation window ไปแล้วไม่มีประโยชน์อีกต่อไป (ไม่ถูกใช้ตัดสินสถานะ) — ตั้ง TTL
// ให้ KV ลบทิ้งเองแทนที่จะสะสมถาวรและทำให้ listParkingReportsForZone ยิ่งช้าลงเรื่อยๆ ตามจำนวน
// report สะสม คูณ 2 ไว้เป็น buffer กัน clock skew / KV eventual consistency
const PARKING_REPORT_TTL_SECONDS = AGGREGATION_WINDOW_MINUTES * 60 * 2;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleParkingReport(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { user_id, zone_id, status, user_lat, user_lng } = payload;
  if (!user_id || !zone_id || !status || typeof user_lat !== 'number' || typeof user_lng !== 'number') {
    return jsonResponse({ error: 'Missing required fields' }, 400);
  }

  // 1. Rate limit (MVP-SPEC §6.1)
  const lastReportedAt = await getLastReportedAt(env, user_id);
  if (lastReportedAt) {
    const minutesSince = (Date.now() - new Date(lastReportedAt).getTime()) / 60000;
    if (minutesSince < RATE_LIMIT_MINUTES) {
      return jsonResponse({ error: 'รายงานถี่เกินไป กรุณารออีกสักครู่' }, 429);
    }
  }

  const zone = await getParkingZoneByKey(env, zone_id);
  if (!zone) {
    // MVP-SPEC §8: zone_id ไม่พบ -> ตอบสุภาพ อย่า hallucinate
    return jsonResponse({ error: 'ไม่พบข้อมูลลานจอดนี้' }, 404);
  }

  // 2. Geofence (MVP-SPEC §6.1)
  const distance = haversineDistanceMeters(user_lat, user_lng, zone.lat, zone.lng);
  if (distance > GEOFENCE_RADIUS_METERS) {
    return jsonResponse({ error: 'คุณอยู่ไกลจากลานจอดนี้เกินไป' }, 422);
  }

  // 3. บันทึก
  const reportedAt = new Date().toISOString();
  await putParkingReport(
    env,
    {
      zone_id,
      reported_status: status,
      reporter_user_id: user_id,
      reported_at: reportedAt,
    },
    PARKING_REPORT_TTL_SECONDS
  );
  await setLastReportedAt(env, user_id, reportedAt);

  // 4. ให้เหรียญ — อยู่หลัง geofence + rate limit จึงกดรัวๆ เพื่อฟาร์มเหรียญไม่ได้
  //    ถ้าตรงนี้พังไม่ควรทำให้รายงานที่บันทึกไปแล้วกลายเป็นล้มเหลว แค่ไม่ได้เหรียญรอบนี้
  //    refId = เวลาที่รายงาน ทำให้ 1 รายงาน = 1 ครั้งเสมอ ต่อให้ handler ถูกเรียกซ้ำ
  let reward = { coins: null, awarded: 0 };
  try {
    reward = await awardParkingReport(env, user_id, reportedAt);
  } catch (e) {
    console.error('awardParkingReport error', e);
  }

  return jsonResponse({ status: 'SUCCESS', coins: reward.coins, awarded: reward.awarded });
}

export async function handleParkingStatus(request, env) {
  const url = new URL(request.url);
  const zoneId = url.searchParams.get('zone_id');
  if (!zoneId) {
    return jsonResponse({ error: 'ต้องระบุ zone_id' }, 400);
  }

  const status = await resolveParkingStatus(env, zoneId);
  if (!status) {
    return jsonResponse({ error: 'ไม่พบข้อมูลลานจอดนี้' }, 404);
  }

  return jsonResponse(status);
}

// GET /api/parking/zone?zone_id= — คืนรายละเอียดลานจอด (ชื่อ/พิกัด) + สถานะปัจจุบัน ในคำเดียว
// ให้ LIFF ?mode=parking&zone_id= เปิดหน้ารายงานของลานจอดนั้นตรงๆ ได้เลย โดยไม่ต้องวน
// /api/buildings + /api/building หาลานจอดที่ใกล้ที่สุดเองเหมือน flow เดิม (default, ไม่มี zone_id)
export async function handleParkingZone(request, env) {
  const url = new URL(request.url);
  const zoneId = url.searchParams.get('zone_id');
  if (!zoneId) {
    return jsonResponse({ error: 'ต้องระบุ zone_id' }, 400);
  }

  const zone = await getParkingZoneByKey(env, zoneId);
  if (!zone) {
    // MVP-SPEC §8: zone_id ไม่พบ -> ตอบสุภาพ อย่า hallucinate
    return jsonResponse({ error: 'ไม่พบข้อมูลลานจอดนี้' }, 404);
  }

  const status = await resolveStatusForZone(env, zone);
  return jsonResponse({ zone, parking_status: status });
}

// GET /api/parking/zones — คืนทุกลานจอด + สถานะปัจจุบัน ในคำขอเดียว
// เดิม LIFF ต้องยิง /api/parking/zone ทีละโซน (8 request ต่อการเปิดแผนที่ 1 ครั้ง) และหน้า
// รายงานที่จอดต้องวน /api/buildings + /api/building ทุกอาคารเพื่อเก็บพิกัดลานจอดมาหาโซนที่ใกล้สุด
// endpoint นี้ยุบทั้งสอง flow เหลือ request เดียว (และอ่าน zone จาก KV โซนละครั้ง ไม่ใช่สองครั้ง)
export async function handleParkingZones(request, env) {
  const zones = await listParkingZones(env);
  const statuses = await Promise.all(zones.map((zone) => resolveStatusForZone(env, zone)));
  return jsonResponse({
    zones: zones.map((zone, i) => ({ zone, parking_status: statuses[i] })),
  });
}

// Aggregation window logic (MVP-SPEC §5) — ใช้ซ้ำใน building.js สำหรับ GET /api/building
// รับ zoneId เมื่อผู้เรียกมีแค่ id (คืน null ถ้าไม่พบโซน) — ถ้ามี zone object อยู่แล้วให้เรียก
// resolveStatusForZone ตรงๆ จะได้ไม่อ่าน BASELINE_DATA ซ้ำโดยเปล่าประโยชน์
export async function resolveParkingStatus(env, zoneId) {
  const zone = await getParkingZoneByKey(env, zoneId);
  if (!zone) return null;
  return resolveStatusForZone(env, zone);
}

export async function resolveStatusForZone(env, zone) {
  const zoneId = zone.zone_id;
  const reports = await listParkingReportsForZone(env, zoneId);
  const cutoff = Date.now() - AGGREGATION_WINDOW_MINUTES * 60000;
  const recentReports = reports.filter((r) => new Date(r.reported_at).getTime() >= cutoff);

  if (recentReports.length > 0) {
    recentReports.sort((a, b) => new Date(b.reported_at) - new Date(a.reported_at));
    const latest = recentReports[0];
    return {
      zone_id: zoneId,
      status: latest.reported_status,
      source: 'live_report',
      as_of: latest.reported_at,
    };
  }

  return {
    zone_id: zoneId,
    status: zone.baseline_status,
    source: 'baseline_estimate',
    as_of: null,
  };
}
