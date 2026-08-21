// GET /api/building?building_id=..., GET /api/buildings
// MVP-SPEC-for-Dev.md §6.3-6.4 — เพิ่มหลังจากฉบับแรก เพราะ LIFF (browser) อ่าน Cloudflare KV ตรงๆ ไม่ได้

import { getBuildingByKey, getParkingZoneByKey, listBuildings } from './data.js';
import { resolveParkingStatus } from './parking.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleGetBuilding(request, env) {
  const url = new URL(request.url);
  const buildingId = url.searchParams.get('building_id');
  if (!buildingId) {
    return jsonResponse({ error: 'ต้องระบุ building_id' }, 400);
  }

  const building = await getBuildingByKey(env, buildingId);
  if (!building) {
    // MVP-SPEC §8: building_id ไม่พบ -> ตอบสุภาพ อย่า hallucinate
    return jsonResponse({ error: 'ไม่พบข้อมูลอาคารนี้' }, 404);
  }

  const zoneId = building.nearest_parking_zone_id;
  const [parkingZone, parkingStatus] = zoneId
    ? await Promise.all([getParkingZoneByKey(env, zoneId), resolveParkingStatus(env, zoneId)])
    : [null, null];

  return jsonResponse({
    building,
    parking_zone: parkingZone,
    parking_status: parkingStatus,
  });
}

export async function handleListBuildings(request, env) {
  const buildings = await listBuildings(env);
  return jsonResponse({ buildings });
}
