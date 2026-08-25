// Records questions the system could not answer, so we can see what data is still missing.
//
// Until now we only learned the bot had failed when someone sent us a screenshot, which means
// every user who hit a gap and quietly gave up was invisible to us. This surfaces the gaps on
// their own, without waiting for feedback.
//
// Only written when we genuinely had no answer, so the volume stays small and D1 quota is not
// a concern (unlike logging every message).

import { maskPII } from './ai.js';
import { requireAdmin } from './shared.js';

const MAX_MESSAGE_LENGTH = 200;

export async function logUnanswered(env, { message, intent = null, focusId = null, reason }) {
  if (!env || !env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO unanswered_queries (id, message, intent, focus_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      maskPII(String(message || '')).slice(0, MAX_MESSAGE_LENGTH),
      intent,
      focusId,
      reason,
      new Date().toISOString()
    ).run();
  } catch (err) {
        // Failing to record this is never a reason to withhold an answer — always swallow it.
    console.error('logUnanswered ไม่สำเร็จ', err);
  }
}

// GET /api/admin/unanswered?limit=100 — requires x-admin-token
//
// Grouped by identical text on purpose: what we want to know is "which kind of question keeps
// coming up that we cannot answer", not a raw feed ordered by time.
export async function handleAdminUnanswered(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);

  const { results } = await env.DB.prepare(
    `SELECT message, intent, focus_id, reason, COUNT(*) AS times, MAX(created_at) AS last_at
       FROM unanswered_queries
      GROUP BY message, intent, focus_id, reason
      ORDER BY times DESC, last_at DESC
      LIMIT ?`
  ).bind(limit).all();

  return new Response(JSON.stringify({ groups: results || [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
