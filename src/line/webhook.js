import { verifySignature } from './signature.js';
import { handleEvent } from './events.js';

export async function handleWebhookRequest(request, env, ctx) {
  const signature = request.headers.get('x-line-signature');
  const bodyText = await request.text();

  if (!signature || !(await verifySignature(bodyText, signature, env.LINE_CHANNEL_SECRET))) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const body = JSON.parse(bodyText);
    const events = body.events || [];

    // ใช้ ctx.waitUntil เพื่อตอบ 200 OK กลับไปหา LINE ทันที ป้องกันปัญหา Webhook Timeout
    ctx.waitUntil(
      Promise.all(events.map(event => handleEvent(event, env)))
    );

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Error in handleWebhookRequest:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
