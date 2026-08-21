// GET /api/parking/status?zone_id=... (MVP spec §6.2)
//
// TODO: implement aggregation window logic ตาม spec §5:
//   1. ดึง reports ทั้งหมดของ zone_id จาก PARKING_REPORTS
//   2. กรองเฉพาะ report ที่ reported_at อยู่ในช่วง N นาทีล่าสุด (แนะนำ N=30)
//   3. มี report ในช่วงนั้น -> ใช้ report ล่าสุด, source: "live_report"
//   4. ไม่มี -> fallback baseline_status จาก BASELINE_DATA, source: "baseline_estimate"
//
// import { getParkingZoneByKey } from '../data/baseline.js';

export async function handleParkingStatus(request, env) {
  return new Response(
    JSON.stringify({ error: 'Not implemented — see MVP spec §5, §6.2' }),
    { status: 501, headers: { 'Content-Type': 'application/json' } }
  );
}
