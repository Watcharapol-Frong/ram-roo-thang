// Function calling ที่ AI agent จะเรียกเอง (MVP spec §4) — ไม่ใช่ MCP Server
// ดู docs/adr/0001-function-calling-instead-of-mcp-for-mvp.md
//
// ยังไม่ implement logic จริง (fuzzy match / aggregation) รอ BASELINE_DATA
// ถูก seed ก่อน (ดู data/baseline-seed.example.json, scripts/seed-baseline.mjs)
// และรอ wiring เข้า src/ai/client.js

import { getBuildingByKey, getParkingZoneByKey } from '../data/baseline.js';

/**
 * @param {string} query ชื่อ/alias ที่ user พิมพ์
 * @returns {Promise<object|null>} building object จาก BASELINE_DATA (fuzzy match กับ aliases)
 */
export async function getBuildingInfo(query, env) {
  throw new Error('Not implemented — TODO: fuzzy match query กับ aliases ใน BASELINE_DATA (MVP spec §4)');
}

/**
 * @param {string} zoneId
 * @returns {Promise<object>} สถานะปัจจุบันตาม aggregation window logic (MVP spec §5)
 */
export async function getParkingStatus(zoneId, env) {
  throw new Error('Not implemented — ดู src/parking/status.js สำหรับ aggregation logic (MVP spec §5)');
}

// เก็บไว้เผื่อ getBuildingInfo ต้องอ้างอิง key แบบตรงตัวระหว่างพัฒนา
export { getBuildingByKey, getParkingZoneByKey };
