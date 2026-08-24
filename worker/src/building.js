// GET /api/building?building_id=..., GET /api/buildings
// MVP-SPEC-for-Dev.md §6.3-6.4 — added after the first draft, because the LIFF page runs in a browser

import { getBuildingByKey, getParkingZoneByKey, listBuildings } from './data.js';
import { resolveStatusForZone } from './parking.js';

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
        // MVP-SPEC §8: unknown building_id -> answer politely, never hallucinate
    return jsonResponse({ error: 'ไม่พบข้อมูลอาคารนี้' }, 404);
  }

    // Read the zone once and pass the object to resolveStatusForZone. The old code passed a zoneId,
    // which made BASELINE_DATA get read twice per request.
  const zoneId = building.nearest_parking_zone_id;
  const parkingZone = zoneId ? await getParkingZoneByKey(env, zoneId) : null;
  const parkingStatus = parkingZone ? await resolveStatusForZone(env, parkingZone) : null;

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
