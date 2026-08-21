import { handleWebhookRequest } from './line/webhook.js';
import { handleParkingReport } from './parking/report.js';
import { handleParkingStatus } from './parking/status.js';

export async function route(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/webhook') {
    return handleWebhookRequest(request, env, ctx);
  }

  if (request.method === 'POST' && url.pathname === '/api/parking/report') {
    return handleParkingReport(request, env);
  }

  if (request.method === 'GET' && url.pathname === '/api/parking/status') {
    return handleParkingStatus(request, env);
  }

  return new Response('Not Found', { status: 404 });
}
