// Answers "what do I have on?" from the student's own saved courses.
//
// Before this, asking the bot "what classes do I have this week" fell through to the AI, which has
// no access to anyone's saved courses and answered that it had no data — while the answer was
// sitting in D1 the whole time. The daily digest already knew how to work this out; it just only
// ran on a cron and only for today.
//
// Keyword matching rather than the LLM, for the same reasons as intent.js: these questions come in
// a handful of shapes, matching is exact, and an LLM could invent a class that does not exist —
// which for a timetable is worse than saying nothing.

import { collectDigests, buildDigestCard } from './daily.js';
// bangkokDate ย้ายไป shared.js แล้ว — ดึงจากต้นทางตรงๆ ไม่ใช่ re-export ผ่าน daily.js
// (ยิ่งดึงผ่านไฟล์ที่อยู่ในวงจร import อยู่แล้ว ยิ่งเพิ่มโอกาสพังตอน init)
import { bangkokDate, liffProfileLink } from './shared.js';
import { resultCard, row, FLEX_TOKENS } from './flex.js';

const DAY_CODES = ['SU', 'M', 'TU', 'W', 'TH', 'F', 'S'];
const THAI_DAY_SHORT = { SU: 'อา', M: 'จ', TU: 'อ', W: 'พ', TH: 'พฤ', F: 'ศ', S: 'ส' };
const THAI_DAY = { SU: 'อาทิตย์', M: 'จันทร์', TU: 'อังคาร', W: 'พุธ', TH: 'พฤหัสบดี', F: 'ศุกร์', S: 'เสาร์' };

// The question has to name both a time window and the fact that it is about classes or exams.
// "พรุ่งนี้ว่างไหม" alone is not a schedule question, and answering it as one would be a guess.
const WHEN = [
  { scope: 'today', re: /วันนี้|today/i },
  { scope: 'tomorrow', re: /พรุ่งนี้|tomorrow/i },
  { scope: 'week', re: /สัปดาห์นี้|อาทิตย์นี้|ทั้งสัปดาห์|this ?week/i },
];
const SUBJECT = /เรียน|สอบ|ตาราง|คาบ|วิชา|class|exam|schedule/i;

export function detectScheduleQuestion(text) {
  if (!text || !SUBJECT.test(text)) return null;
  const when = WHEN.find((w) => w.re.test(text));
  if (!when) return null;
  return { scope: when.scope };
}

function addDays(dateIso, n) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayCodeOf(dateIso) {
  return DAY_CODES[new Date(`${dateIso}T00:00:00Z`).getUTCDay()];
}

// One day's worth for one student. collectDigests scans every user, so filter to this one — the
// result set is tiny either way, but scanning all users to answer one person's question is wasteful
// and gets worse as the beta grows.
async function digestFor(env, userId, dateIso) {
  const all = await collectDigests(env, dateIso, dayCodeOf(dateIso), userId);
  return all[0] || null;
}

function emptyCard(liffUrl, headline, note) {
  const uri = liffProfileLink(liffUrl);
  return resultCard({
    title: 'ตารางของคุณ',
    headerColor: FLEX_TOKENS.blueSoft,
    hero: headline,
    heroNote: note,
    rows: [],
    actions: [{ label: 'เปิดตารางของฉัน', action: { type: 'uri', label: 'เปิดตาราง', uri } }],
    altText: headline,
  });
}

// A week is seven separate day lookups rather than one clever query. Seven small reads against a
// table this size cost nothing, and it reuses the exact code path the daily digest uses — so the
// week view can never drift from what the morning message says.
async function weekCard(env, userId, liffUrl) {
  const start = bangkokDate();
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const dateIso = addDays(start, i);
    const digest = await digestFor(env, userId, dateIso);
    if (digest) days.push({ dateIso, dayCode: dayCodeOf(dateIso), digest });
  }

  if (!days.length) {
    return emptyCard(liffUrl, 'สัปดาห์นี้ยังไม่มีรายการ',
      'บันทึกวิชาไว้ก่อน ระบบจะดึงตารางเรียนและตารางสอบมาให้เอง');
  }

  const rows = days.map(({ dateIso, dayCode, digest }) => {
    const items = [
      ...digest.exams.map((e) => `${e.code} สอบ`),
      ...digest.classes.map((c) => c.code),
    ];
    // Duplicates happen when one course meets twice in a day; the reader does not need to see the
    // course code twice on a summary line.
    const unique = [...new Set(items)];
    const label = `${THAI_DAY_SHORT[dayCode]}  ${dateIso.slice(8)}/${dateIso.slice(5, 7)}`;
    return row(label, unique.join(', '), {
      strong: digest.exams.length > 0,
      color: digest.exams.length ? FLEX_TOKENS.red : FLEX_TOKENS.ink,
    });
  });

  const examDays = days.filter((d) => d.digest.exams.length).length;
  const uri = liffProfileLink(liffUrl);

  return resultCard({
    title: 'สัปดาห์นี้ของคุณ',
    badge: `${days.length} วัน`,
    headerColor: examDays ? FLEX_TOKENS.amberSoft : FLEX_TOKENS.blueSoft,
    hero: `มีรายการ ${days.length} วัน`,
    heroNote: examDays ? `มีสอบ ${examDays} วัน` : 'ไม่มีสอบในสัปดาห์นี้',
    rows,
    note: 'ถามว่า "วันนี้เรียนอะไร" เพื่อดูเวลาและห้องแบบละเอียดได้ครับ',
    actions: [{ label: 'เปิดตารางของฉัน', action: { type: 'uri', label: 'เปิดตาราง', uri } }],
    altText: `สัปดาห์นี้มีรายการ ${days.length} วัน`,
  });
}

// Returns an array of LINE messages, or null to let the caller fall through to its normal handling.
export async function answerMySchedule(env, userId, ask) {
  if (!userId) return null;

  try {
    if (ask.scope === 'week') {
      return [await weekCard(env, userId, env.LIFF_URL)];
    }

    const dateIso = ask.scope === 'tomorrow' ? addDays(bangkokDate(), 1) : bangkokDate();
    const digest = await digestFor(env, userId, dateIso);
    const when = ask.scope === 'tomorrow' ? 'พรุ่งนี้' : 'วันนี้';

    if (!digest) {
      const dayName = THAI_DAY[dayCodeOf(dateIso)];
      return [emptyCard(env.LIFF_URL, `${when}ไม่มีรายการครับ`,
        `วัน${dayName} ไม่มีคาบเรียนหรือวิชาสอบจากวิชาที่คุณบันทึกไว้`)];
    }

    return [buildDigestCard(digest, env.LIFF_URL)];
  } catch (err) {
    // Never break the chat over this — fall through and let the normal path answer.
    console.error('answerMySchedule failed', err);
    return null;
  }
}
