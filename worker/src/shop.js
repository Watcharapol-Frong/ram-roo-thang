// GET /api/shops — ร้านค้า/ซุ้มในแคมปัส สำหรับแท็บ "ร้านค้า/ซุ้ม" ใน LIFF
// ข้อมูลนิ่ง ไม่มีสถานะเปลี่ยนตามเวลาเหมือนลานจอด จึงคืนรายการตรงๆ ไม่ต้อง resolve อะไรเพิ่ม

import { listShops } from './data.js';

export async function handleListShops(request, env) {
  const shops = await listShops(env);
  return new Response(JSON.stringify({ shops }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
