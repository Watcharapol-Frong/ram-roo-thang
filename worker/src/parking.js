// POST /api/parking/report, GET /api/parking/status
// MVP-SPEC-for-Dev.md §5 (Aggregation Window), §6.1-6.2
// CONTEXT.md "Parking Check-in (Crowdsourced Report)", "Geofence Validation", "Aggregation Window"

import { haversineDistanceMeters } from './utils.js';
import {
  getParkingZoneByKey,
  listParkingZones,
  insertParkingReport,
  listRecentParkingReports,
  getLatestOtherReport,
  getLastReportedAt,
  setLastReportedAt,
} from './data.js';
import { awardParkingReport, awardParkingReportConfirmed } from './user.js';
import { jsonResponse } from './shared.js';

// สองค่านี้เคยเท่ากันโดยบังเอิญและเคยผูกกันด้วย (TTL ของ KV คำนวณจาก AGGREGATION_WINDOW) แต่เป็น
// คนละเรื่องกัน: RATE_LIMIT คือ "คนหนึ่งรายงานถี่แค่ไหน" (กันสแปม) ส่วน AGGREGATION_WINDOW คือ
// "รายงานเก่าได้แค่ไหนถึงยังนับ" (ความสดของข้อมูล) ปรับตัวหนึ่งไม่ควรลากอีกตัวไปด้วยโดยไม่ตั้งใจ
const RATE_LIMIT_MINUTES = 30;
const GEOFENCE_RADIUS_METERS = 150;
const AGGREGATION_WINDOW_MINUTES = 30;

const windowStartIso = (nowMs) => new Date(nowMs - AGGREGATION_WINDOW_MINUTES * 60000).toISOString();

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

  // 3. บันทึกเป็นแถวใหม่ ไม่ทับของใคร — สองคนกดพร้อมกันได้สองแถว ไม่ใช่แถวเดียวที่คนหลังชนะ
  const now = Date.now();
  const reportedAt = new Date(now).toISOString();
  // อ่านของคนก่อนหน้าไว้ก่อนบันทึก จะได้ไม่เจอแถวของตัวเองที่เพิ่งใส่ไป
  const previous = await getLatestOtherReport(env, zone_id, user_id, windowStartIso(now));
  await insertParkingReport(env, {
    zone_id,
    status,
    reporter_user_id: user_id,
    reported_at: reportedAt,
  });
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

  // 5. โบนัสความแม่นให้คนที่รายงานไว้ก่อนหน้า เมื่อคนนี้มาเห็นตรงกัน
  //
  //    ยังใช้กติกา "คนถัดไปเห็นตรงกัน" ไม่ใช่ "ตรงกับเสียงส่วนใหญ่ตอนปิดกรอบเวลา" เพราะอย่างหลัง
  //    ต้องรอจนกรอบเวลาปิดถึงจะรู้ผล แปลว่าต้องมีงานตามจ่ายย้อนหลังอีกชุด ส่วนแบบนี้จ่ายจบในคำขอ
  //    เดียวและให้ผลใกล้เคียงกัน เพราะการกดมั่วจะบังเอิญตรงกับคนถัดไปแค่ราว 1 ใน 3
  //
  //    ต้องคนละคนกันเท่านั้น (query กรองให้แล้ว) ไม่งั้นก็ยืนยันตัวเองรับโบนัสได้ทุกครั้งที่
  //    rate limit หมดอายุพอดี และฝั่ง LIFF ไม่ได้โชว์สถานะปัจจุบันก่อนกดรายงาน คนกดจึงไม่รู้ว่า
  //    ต้องตอบอะไรถึงจะตรง โบนัสนี้เลยวัดการเห็นตรงกันจริง ไม่ใช่การเดาใจระบบ
  //
  //    refId ใช้ id ของแถวที่ถูกยืนยัน (ไม่ใช่เวลา) — เป็นค่าที่ไม่ซ้ำแน่นอนแม้สองรายงานจะมี
  //    timestamp เดียวกันเป๊ะจากการกดพร้อมกัน
  //
  //    พังตรงนี้ไม่ควรทำให้รายงานที่บันทึกไปแล้วกลายเป็นล้มเหลว เหมือนกับเหรียญก้อนแรก
  try {
    if (previous && previous.status === status) {
      await awardParkingReportConfirmed(env, previous.reporter_user_id, String(previous.id));
    }
  } catch (e) {
    console.error('awardParkingReportConfirmed error', e);
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
//
// อ่านรายงานของ "ทุกลาน" ด้วย query เดียวแล้วแยกกลุ่มในโค้ด ไม่ใช่ยิงทีละลาน — ลานมี 8 ลาน
// การเรียก resolveStatusForZone วนทีละลานจะกลายเป็น 8 query ต่อการเปิดแผนที่ 1 ครั้ง
export async function handleParkingZones(request, env) {
  const now = Date.now();
  const [zones, reports] = await Promise.all([
    listParkingZones(env),
    listRecentParkingReports(env, windowStartIso(now)),
  ]);

  const byZone = new Map();
  for (const r of reports) {
    if (!byZone.has(r.zone_id)) byZone.set(r.zone_id, []);
    byZone.get(r.zone_id).push(r);
  }

  return jsonResponse({
    zones: zones.map((zone) => ({
      zone,
      parking_status: aggregateStatus(zone, byZone.get(zone.zone_id) || [], now),
    })),
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
  const now = Date.now();
  const reports = await listRecentParkingReports(env, windowStartIso(now), zone.zone_id);
  return aggregateStatus(zone, reports, now);
}

// รวมผลรายงานหลายใบเป็นสถานะเดียว — หัวใจของการแก้ปัญหา "คนใหม่มารายงานก็ทับอันเก่า"
//
// ถ่วงน้ำหนักตามอายุแบบเชิงเส้น: รายงานเมื่อกี้นี้มีน้ำหนักเกือบ 1 ส่วนรายงานที่ใกล้หมดกรอบเวลา
// เหลือเกือบ 0 ทำให้ข้อมูลค่อยๆ จางแทนที่จะหายวับตอนครบ 30 นาทีพอดี และทำให้รายงานใหม่ชนะ
// รายงานเก่าได้เองโดยไม่ต้องเขียนทับใคร — สภาพลานที่เปลี่ยนจริงจึงยังสะท้อนได้ทันที
//
// ใช้เสียงข้างมากแบบถ่วงน้ำหนัก ไม่ใช่ค่าเฉลี่ย เพราะสถานะเป็นหมวดหมู่ (GREEN/YELLOW/RED)
// ค่าเฉลี่ยของ "เบาบาง" กับ "หนาแน่น" ไม่ใช่ "ปานกลาง" ในความหมายของข้อมูลชุดนี้ — มันแปลว่า
// สองคนเห็นไม่ตรงกัน ซึ่งเป็นคนละเรื่องกับการที่ทั้งสองคนเห็นว่าปานกลาง
//
// agreement = สัดส่วนน้ำหนักของสถานะที่ชนะ ใช้บอกความมั่นใจได้ (1.0 = ทุกคนเห็นตรงกัน)
// ยังไม่มีใครแสดงผลค่านี้ แต่คำนวณให้ตรงนี้เพราะเป็นที่เดียวที่มีข้อมูลครบพอจะคิดได้
export function aggregateStatus(zone, reports, nowMs) {
  const zoneId = zone.zone_id;

  if (!reports || reports.length === 0) {
    return {
      zone_id: zoneId,
      status: zone.baseline_status,
      source: 'baseline_estimate',
      as_of: null,
      sample_size: 0,
      agreement: null,
    };
  }

  const weights = new Map();
  let totalWeight = 0;
  let newestAt = null;

  for (const r of reports) {
    const ageMinutes = (nowMs - Date.parse(r.reported_at)) / 60000;
    // กันค่าติดลบจากนาฬิกาเครื่องที่เดินไม่ตรงกัน และกันน้ำหนัก 0 สนิทของรายงานที่ขอบพอดี
    // (รายงานที่ยัง query ติดมาแปลว่ายังอยู่ในกรอบ ควรมีสิทธิ์ออกเสียงอยู่บ้าง)
    const weight = Math.max(0.01, Math.min(1, 1 - ageMinutes / AGGREGATION_WINDOW_MINUTES));
    weights.set(r.status, (weights.get(r.status) || 0) + weight);
    totalWeight += weight;
    if (!newestAt || r.reported_at > newestAt) newestAt = r.reported_at;
  }

  // reports เรียงใหม่สุดมาก่อน และเทียบด้วย > แบบเข้ม สถานะที่คะแนนเท่ากันจึงตัดสินด้วย
  // "ใครถูกเจอก่อน" = รายงานที่ใหม่กว่า ซึ่งเป็นตัวเลือกที่ถูกต้องเมื่อเสียงแตกครึ่งพอดี
  let best = null;
  let bestWeight = -1;
  for (const r of reports) {
    const w = weights.get(r.status);
    if (w > bestWeight) {
      best = r.status;
      bestWeight = w;
    }
  }

  return {
    zone_id: zoneId,
    status: best,
    source: 'live_report',
    as_of: newestAt,
    sample_size: reports.length,
    agreement: Math.round((bestWeight / totalWeight) * 100) / 100,
  };
}
