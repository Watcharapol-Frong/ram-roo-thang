// KV accessor สำหรับ BASELINE_DATA (MVP spec §3.1) — เขียนด้วยมือล่วงหน้า ไม่เปลี่ยนขณะรัน
// Seed ผ่าน scripts/seed-baseline.mjs จาก data/baseline-seed.example.json

export async function getBuildingByKey(env, buildingId) {
  const raw = await env.BASELINE_DATA.get(`building:${buildingId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function getParkingZoneByKey(env, zoneId) {
  const raw = await env.BASELINE_DATA.get(`parking_zone:${zoneId}`);
  return raw ? JSON.parse(raw) : null;
}
