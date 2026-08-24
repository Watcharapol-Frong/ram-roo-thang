// Router หลัก — LINE webhook + API endpoints (MVP-SPEC-for-Dev.md §2, §6)

import { handleWebhookRequest } from './line.js';
import { handleParkingReport, handleParkingStatus, handleParkingZone, handleParkingZones } from './parking.js';
import { handleGetBuilding, handleListBuildings } from './building.js';
import { handleListShops, handleListShopItems, handleRedeemItem, handleListRedemptions, handleAdminListRedemptions, handleAdminFulfill } from './shop.js';
import { handlePostSchedule, handleGetSchedule, handleDeleteSchedule } from './schedule.js';
import { handleGetUser, handleGetLedger, handleFeedbackAward, handleSaveCarAward } from './user.js';
import { handleAdminExamAlerts, runDailyExamAlerts } from './exam.js';

// LIFF (liff/) เป็น static site คนละ origin กับ worker นี้เสมอ — ต้องมี CORS ให้ /api/* ถึงจะเรียก
// fetch() จากฝั่ง browser ได้จริง (ไม่มีมาก่อนหน้านี้ ทำให้ทุก endpoint ใต้ /api/ เรียกจาก LIFF ไม่ได้เลย
// ไม่ใช่แค่ปัญหาตอน dev — เป็น pre-existing bug ที่บล็อก LIFF ทั้งหน้าใน production ด้วย)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      const response = await route(request, env, ctx);
      if (url.pathname.startsWith('/api/')) {
        const headers = new Headers(response.headers);
        for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
        return new Response(response.body, { status: response.status, headers });
      }
      return response;
    } catch (error) {
      console.error('Error in fetch:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },

  // Cron Trigger (ดู [triggers] ใน wrangler.toml) — เตือนล่วงหน้าว่าพรุ่งนี้มีสอบวิชาอะไร
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyExamAlerts(env).catch((err) => console.error('scheduled error', err)));
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const { method } = request;
  const { pathname } = url;

  if (method === 'POST' && pathname === '/webhook') {
    return handleWebhookRequest(request, env, ctx);
  }

  if (method === 'POST' && pathname === '/api/parking/report') {
    return handleParkingReport(request, env);
  }
  if (method === 'GET' && pathname === '/api/parking/status') {
    return handleParkingStatus(request, env);
  }
  if (method === 'GET' && pathname === '/api/parking/zone') {
    return handleParkingZone(request, env);
  }
  if (method === 'GET' && pathname === '/api/parking/zones') {
    return handleParkingZones(request, env);
  }

  if (method === 'GET' && pathname === '/api/shops') {
    return handleListShops(request, env);
  }

  if (method === 'GET' && pathname === '/api/building') {
    return handleGetBuilding(request, env);
  }
  if (method === 'GET' && pathname === '/api/buildings') {
    return handleListBuildings(request, env);
  }

  if (method === 'GET' && pathname === '/api/admin/redemptions') {
    return handleAdminListRedemptions(request, env);
  }
  if (method === 'POST' && pathname === '/api/admin/redemptions/fulfill') {
    return handleAdminFulfill(request, env);
  }
  if (method === 'POST' && pathname === '/api/admin/exam-alerts') {
    return handleAdminExamAlerts(request, env);
  }

  if (method === 'GET' && pathname === '/api/shop/items') {
    return handleListShopItems(request, env);
  }
  if (method === 'POST' && pathname === '/api/shop/redeem') {
    return handleRedeemItem(request, env);
  }
  if (method === 'GET' && pathname === '/api/shop/redemptions') {
    return handleListRedemptions(request, env);
  }

  if (method === 'GET' && pathname === '/api/user') {
    return handleGetUser(request, env);
  }
  if (method === 'GET' && pathname === '/api/user/ledger') {
    return handleGetLedger(request, env);
  }
  if (method === 'POST' && pathname === '/api/user/feedback') {
    return handleFeedbackAward(request, env);
  }
  if (method === 'POST' && pathname === '/api/user/save-car') {
    return handleSaveCarAward(request, env);
  }

  if (pathname === '/api/schedule') {
    if (method === 'POST') return handlePostSchedule(request, env);
    if (method === 'GET') return handleGetSchedule(request, env);
    if (method === 'DELETE') return handleDeleteSchedule(request, env);
  }

  return new Response('Not Found', { status: 404 });
}
