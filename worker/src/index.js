// Router หลัก — LINE webhook + API endpoints (MVP-SPEC-for-Dev.md §2, §6)

import { handleWebhookRequest } from './line.js';
import { handleParkingReport, handleParkingStatus } from './parking.js';
import { handleGetBuilding, handleListBuildings } from './building.js';
import { handlePostSchedule, handleGetSchedule, handleDeleteSchedule } from './schedule.js';

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      console.error('Error in fetch:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
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

  if (method === 'GET' && pathname === '/api/building') {
    return handleGetBuilding(request, env);
  }
  if (method === 'GET' && pathname === '/api/buildings') {
    return handleListBuildings(request, env);
  }

  if (pathname === '/api/schedule') {
    if (method === 'POST') return handlePostSchedule(request, env);
    if (method === 'GET') return handleGetSchedule(request, env);
    if (method === 'DELETE') return handleDeleteSchedule(request, env);
  }

  return new Response('Not Found', { status: 404 });
}
