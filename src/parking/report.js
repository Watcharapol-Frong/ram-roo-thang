// POST /api/parking/report (MVP spec §6.1)
//
// TODO: implement ตามลำดับ validation ที่ spec กำหนด ก่อนใช้งานจริงต้อง seed
// BASELINE_DATA และผูก KV namespace PARKING_REPORTS / RATE_LIMIT ใน wrangler.toml
// (ใส่ id จริงแทน REPLACE_ME_* ก่อน)
//
//   1. Rate limit  — เช็ค RATE_LIMIT:{user_id} ถ้ารายงานล่าสุด < 30 นาทีที่แล้ว -> 429
//   2. Geofence    — haversineDistanceMeters(user_lat/lng, zone lat/lng) เกิน 150m -> 422
//   3. ผ่านทั้งคู่ -> เขียน PARKING_REPORTS, อัปเดต RATE_LIMIT -> 200 { status: "SUCCESS" }
//
// import { haversineDistanceMeters } from './geofence.js';
// import { getParkingZoneByKey } from '../data/baseline.js';

export async function handleParkingReport(request, env) {
  return new Response(
    JSON.stringify({ error: 'Not implemented — see MVP spec §6.1' }),
    { status: 501, headers: { 'Content-Type': 'application/json' } }
  );
}
