// Small helpers that were copy-pasted across worker modules.
//
// Nothing here changes behaviour — every function is the exact logic that already existed,
// moved to one place. The point is that these are the pieces most likely to drift apart:
// the exam period times had already diverged between two files before this was written
// ('09:00 - 12:00 น.' in one, '09:00 - 12:00' in the other), and drift in time or date
// handling means telling a student the wrong hour, not just untidy code.
//
// This module must not import anything from the worker's own modules. It sits at the bottom
// of the dependency graph on purpose: line.js -> myschedule.js -> daily.js -> line.js is
// already a cycle, and a shared module that joined it could turn a harmless import loop into
// a temporal-dead-zone crash at boot, which takes the whole worker down on every request.

// --- HTTP ---

// Every handler was building this Response by hand, three of them with a local jsonResponse()
// of their own and the rest inline.
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Admin endpoints can push LINE messages to real users and expose usage numbers, so the token
// check was repeated in five handlers. One missed check is a public write endpoint.
//
// Returns null when the caller is authorised, or the 401 Response to return as-is.
export function isAdminRequest(request, env) {
  return Boolean(env.ADMIN_TOKEN) && request.headers.get('x-admin-token') === env.ADMIN_TOKEN;
}

export function requireAdmin(request, env) {
  if (!isAdminRequest(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  return null;
}

// --- Bangkok time ---
//
// The worker runs on UTC. Adding 7 hours and then reading the value as UTC gives the Thai
// calendar date and weekday. Using getDay()/getDate() directly is wrong between 00:00 and
// 07:00 UTC — which is exactly when the morning digest cron fires.

const BANGKOK_OFFSET_MS = 7 * 3600 * 1000;

export function bangkokNow(at = Date.now()) {
  return new Date(at + BANGKOK_OFFSET_MS);
}

// 'YYYY-MM-DD' in Thai local time.
export function bangkokDate(at = Date.now()) {
  return bangkokNow(at).toISOString().slice(0, 10);
}

// Day codes match the `day` column in class_sessions. getUTCDay() is 0 = Sunday.
export const DAY_CODES = ['SU', 'M', 'TU', 'W', 'TH', 'F', 'S'];

export function bangkokDayCode(at = Date.now()) {
  return DAY_CODES[bangkokNow(at).getUTCDay()];
}

// Day code for a given 'YYYY-MM-DD' — used by the admin trigger so testing a past or future
// date reports that date's weekday, not today's.
export function dayCodeForDate(iso) {
  return DAY_CODES[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

// --- Thai dates ---

const THAI_MONTH_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                         'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export const THAI_DAY_NAME = {
  SU: 'อาทิตย์', M: 'จันทร์', TU: 'อังคาร', W: 'พุธ', TH: 'พฤหัสบดี', F: 'ศุกร์', S: 'เสาร์',
};

// '2026-10-25' -> '25 ต.ค. 69' (Buddhist year, last two digits)
export function formatThaiDate(iso) {
  const [year, month, day] = String(iso).split('-').map(Number);
  return `${day} ${THAI_MONTH_ABBR[month - 1]} ${String(year + 543).slice(-2)}`;
}

export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

// --- Places ---

// 'VKB 501' -> 'VKB', so a room can be turned into a navigation link.
//
// Deliberately not the same as buildingCodeFromName() in liff/app.js: that one also handles
// building names where a digit is part of the code ('ECB 2'), which would swallow the first
// digit of a room number here.
export function buildingCodeFromRoom(room) {
  if (!room) return null;
  const match = String(room).trim().match(/^([A-Z]{2,4})\b/);
  return match ? match[1] : null;
}

// --- LIFF links ---

// Appending a query param to the LIFF URL appeared in eight places, each re-deciding whether
// the separator should be '?' or '&'.
export function liffLink(liffUrl, params = '') {
  const base = liffUrl || 'https://line.me';
  if (!params) return base;
  return `${base}${base.includes('?') ? '&' : '?'}${params}`;
}

export function liffProfileLink(liffUrl) {
  return liffLink(liffUrl, 'mode=profile');
}

export function liffDestLink(liffUrl, buildingId) {
  return liffLink(liffUrl, `dest_id=${encodeURIComponent(buildingId)}`);
}

// --- LINE push ---

// One message per person means one API call per person. Batched so a few hundred recipients
// don't hit the Messaging API rate limit all at once.
export const PUSH_BATCH_SIZE = 20;

// A push failure is only worth retrying when the cause could go away: 5xx or a network error.
// A 4xx usually means the user blocked the OA, and retrying that every day burns the LINE
// account's monthly message quota on someone who will never receive it.
export function isRetriablePushError(err) {
  return !err || !err.status || err.status >= 500;
}
