// สรุปประจำวัน — เช้าวันนั้นบอกทีเดียวว่าวันนี้เรียนอะไร สอบอะไร ต้องไปที่ไหนบ้าง
//
// ส่ง 07:00 น. (cron "0 0 * * *" = 00:00 UTC) ดู [triggers] ใน wrangler.toml
// ทำงานคู่กับการเตือนสอบล่วงหน้า 1 วันตอน 18:00 น. — ตัวเย็นทำหน้าที่ "เตรียมตัว"
// ตัวเช้าทำหน้าที่ "วันนี้ไปไหน" วิชาสอบจึงถูกเตือนสองรอบโดยตั้งใจ เพราะสอบพลาดเสียหายกว่าเรียน
//
// ข้อมูลสองแหล่ง: ตารางเรียนอยู่ใน D1 (class_sessions) เพราะต้อง join กับวิชาที่ผู้ใช้บันทึก
// ส่วนตารางสอบ bundle มากับ worker เพราะเป็นตารางเดียวทั้งมหาวิทยาลัย ไม่ต้อง join กับอะไร

import examLookup from '../../data/exam-lookup.json' with { type: 'json' };
import { pushToLINE } from './line.js';
import { resultCard, row, FLEX_TOKENS } from './flex.js';
import { bangkokDate, bangkokDayCode, dayCodeForDate, formatThaiDate, THAI_DAY_NAME,
         buildingCodeFromRoom, jsonResponse, requireAdmin, isIsoDate, liffLink, liffDestLink,
         PUSH_BATCH_SIZE, isRetriablePushError } from './shared.js';

// เวลาของแต่ละคาบมาจาก data/exam-lookup.json ซึ่งเป็นไฟล์เดียวกับที่เก็บวันสอบทุกวิชา
// และทั้ง worker กับ LIFF โหลดไฟล์นี้อยู่แล้วทั้งคู่ จึงไม่ต้องเพิ่ม endpoint หรือ dependency ใหม่
//
// ก่อนหน้านี้ค่านี้ถูกประกาศซ้ำ 3 ที่แล้วเพี้ยนกันจริง — exam.js มี "น." ต่อท้าย daily.js ไม่มี
// ผู้ใช้คนเดียวกันจึงเห็นเวลาสอบคนละรูปแบบระหว่างการ์ดเตือนล่วงหน้ากับการ์ดสรุปเช้า
// fallback ไว้เผื่อไฟล์เก่าที่ยังไม่มีคีย์นี้ จะได้ไม่พังตอน deploy สลับเวอร์ชัน
const EXAM_PERIOD_TIME = examLookup.period_times || { A: '09:00 - 12:00 น.', B: '14:00 - 16:30 น.' };


// วิชาที่เปิดหลายกลุ่มถูกข้ามไป — ระบบรู้แค่รหัสวิชา ไม่รู้ว่าผู้ใช้อยู่กลุ่มไหน
// ถ้าเดาแล้วผิดคือส่งเขาไปผิดห้องผิดเวลา ซึ่งแย่กว่าไม่เตือนเลย
// (COUNT(DISTINCT section) ของ SQLite ไม่นับ NULL วิชากลุ่มเดียวที่ไม่ระบุ SEC. จึงได้ 0 และผ่าน)
const CLASS_QUERY = `
  SELECT uc.user_id, cs.course_code, cs.start_time, cs.end_time, cs.room, cs.building_code
    FROM user_courses uc
    JOIN class_sessions cs ON cs.course_code = uc.course_code
   WHERE cs.day = ?
     AND cs.course_code NOT IN (
       SELECT course_code FROM class_sessions GROUP BY course_code HAVING COUNT(DISTINCT section) > 1
     )
`;

// รวบรวมว่าใครมีอะไรวันนี้บ้าง — แยกจากการส่งจริงเพื่อให้ dry-run เดินโค้ดเส้นทางเดียวกันเป๊ะ
export async function collectDigests(env, dateIso, dayCode, onlyUserId = null) {
  const byUser = new Map();
  const ensure = (userId) => {
    if (!byUser.has(userId)) byUser.set(userId, { classes: [], exams: [] });
    return byUser.get(userId);
  };

  const classes = onlyUserId
    ? await env.DB.prepare(`${CLASS_QUERY} AND uc.user_id = ?`).bind(dayCode, onlyUserId).all()
    : await env.DB.prepare(CLASS_QUERY).bind(dayCode).all();
  for (const r of classes.results || []) {
    ensure(r.user_id).classes.push({
      code: r.course_code,
      time: `${r.start_time}-${r.end_time}`,
      sortKey: r.start_time,
      place: r.room,
      buildingCode: r.building_code,
    });
  }

  // วิชาที่สอบวันนี้ — ห้องสอบมาจาก user_courses.room (ผู้ใช้ส่งรูปหรือกรอกเอง) ไม่ใช่จากประกาศ
  const saved = onlyUserId
    ? await env.DB.prepare('SELECT user_id, course_code, room FROM user_courses WHERE user_id = ?').bind(onlyUserId).all()
    : await env.DB.prepare('SELECT user_id, course_code, room FROM user_courses').all();
  for (const r of saved.results || []) {
    const value = examLookup.courses[r.course_code];
    if (!value || value.slice(0, 10) !== dateIso) continue;
    const periods = value.slice(10).split('');
    ensure(r.user_id).exams.push({
      code: r.course_code,
      time: periods.map((p) => EXAM_PERIOD_TIME[p] || `คาบ ${p}`).join(' และ '),
      sortKey: periods.includes('A') ? '09:00' : '14:00',
      place: r.room,
      buildingCode: buildingCodeFromRoom(r.room),
    });
  }

  return [...byUser.entries()]
    .filter(([, v]) => v.classes.length || v.exams.length)
    .map(([userId, v]) => ({ userId, dateIso, dayCode, ...v }));
}

// การ์ดสรุป — เรียงตามเวลาจริงไม่แยกเรียน/สอบเป็นสองก้อน
// เพราะสิ่งที่ผู้ใช้ต้องรู้คือ "วันนี้ไปไหนก่อน" ไม่ใช่ "วันนี้มีสอบกี่วิชา"
export function buildDigestCard(digest, liffUrl) {
  const linkTo = (buildingCode) =>
    (buildingCode ? liffDestLink(liffUrl, buildingCode) : liffLink(liffUrl, 'mode=profile'));

  const items = [
    ...digest.exams.map((e) => ({ ...e, kind: 'สอบ' })),
    ...digest.classes.map((c) => ({ ...c, kind: 'เรียน' })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.code.localeCompare(b.code));

  const rows = items.map((item) => {
    const place = item.place || (item.kind === 'สอบ' ? 'รอห้องสอบ' : '');
    const line = row(
      `${item.time}  ${item.kind}`,
      place ? `${item.code}  ${place}` : item.code,
      { strong: item.kind === 'สอบ', color: item.kind === 'สอบ' ? FLEX_TOKENS.red : FLEX_TOKENS.ink },
    );
    // ทั้งแถวกดได้เมื่อรู้ว่าไปตึกไหน — ไม่ทำปุ่ม Go แยกทีละแถวเพราะการ์ดจะยาวขึ้นเท่าตัว
    if (item.buildingCode) {
      line.action = { type: 'uri', label: 'ไป ' + item.buildingCode, uri: linkTo(item.buildingCode) };
    }
    return line;
  });

  const examCount = digest.exams.length;
  const classCount = digest.classes.length;
  const summary = [examCount ? `สอบ ${examCount}` : '', classCount ? `เรียน ${classCount}` : '']
    .filter(Boolean).join(' · ');

  const firstNavigable = items.find((item) => item.buildingCode);

  return resultCard({
    title: `วันนี้ ${THAI_DAY_NAME[digest.dayCode]}`,
    badge: summary,
    headerColor: examCount ? FLEX_TOKENS.amberSoft : FLEX_TOKENS.blueSoft,
    hero: formatThaiDate(digest.dateIso),
    heroNote: examCount ? 'มีสอบวันนี้ เผื่อเวลาเดินทางด้วยนะครับ' : 'แตะแต่ละรายการเพื่อดูเส้นทาง',
    rows,
    actions: firstNavigable
      ? [{ label: `นำทางไป ${firstNavigable.place || firstNavigable.buildingCode}`,
           action: { type: 'uri', label: 'Go', uri: linkTo(firstNavigable.buildingCode) } }]
      : [{ label: 'เปิดตารางของฉัน',
           action: { type: 'uri', label: 'เปิด', uri: linkTo(null) } }],
    altText: `วันนี้ ${summary}`,
  });
}

// ส่งจริง — จองแถวก่อนยิงเสมอ เหตุผลเดียวกับ exam alerts
export async function runDailyDigest(env, { dateIso, dayCode, dryRun = false } = {}) {
  const date = dateIso || bangkokDate();
  const day = dayCode || bangkokDayCode();
  const digests = await collectDigests(env, date, day);
  const summary = { date, day, dryRun, candidates: digests.length, sent: 0, skipped: 0, failed: 0 };

  if (dryRun) {
    return {
      ...summary,
      preview: digests.slice(0, 3).map((d) => ({
        classes: d.classes.map((c) => `${c.time} ${c.code} ${c.place || ''}`.trim()),
        exams: d.exams.map((e) => `${e.time} ${e.code} ${e.place || 'รอห้องสอบ'}`),
      })),
    };
  }

  for (let i = 0; i < digests.length; i += PUSH_BATCH_SIZE) {
    const batch = digests.slice(i, i + PUSH_BATCH_SIZE);
    await Promise.all(batch.map(async (digest) => {
      const count = digest.classes.length + digest.exams.length;
      let claimed;
      try {
        claimed = await env.DB.prepare(
          `INSERT INTO daily_digest_sent (user_id, digest_date, items, sent_at)
           VALUES (?, ?, ?, ?) ON CONFLICT(user_id, digest_date) DO NOTHING`
        ).bind(digest.userId, date, count, new Date().toISOString()).run();
      } catch (err) {
        console.error('daily digest: บันทึกไม่สำเร็จ', err);
        summary.failed += 1;
        return;
      }

      if (!claimed.meta || claimed.meta.changes === 0) {
        summary.skipped += 1;
        return;
      }

      try {
        await pushToLINE(digest.userId, [buildDigestCard(digest, env.LIFF_URL)], env.LINE_CHANNEL_ACCESS_TOKEN);
        summary.sent += 1;
      } catch (err) {
        summary.failed += 1;
        console.error('daily digest: ส่ง LINE ไม่สำเร็จ', digest.userId, err);
        // ถอนการจองคืนเฉพาะกรณีที่ลองใหม่แล้วมีโอกาสสำเร็จ เหมือน exam alerts
        if (isRetriablePushError(err)) {
          await env.DB.prepare('DELETE FROM daily_digest_sent WHERE user_id = ? AND digest_date = ?')
            .bind(digest.userId, date).run().catch((e) => console.error('rollback ไม่สำเร็จ', e));
        }
      }
    }));
  }

  return summary;
}

// POST /api/admin/daily-digest — ยิงมือสำหรับทดสอบ/เดโม
export async function handleAdminDailyDigest(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  let payload = {};
  try {
    payload = await request.json();
  } catch { /* ไม่มี body ก็ได้ */ }

  const date = payload.date || bangkokDate();
  if (!isIsoDate(date)) {
    return jsonResponse({ error: 'date ต้องเป็นรูปแบบ YYYY-MM-DD' }, 400);
  }

  // คำนวณวันในสัปดาห์จากวันที่ที่ขอ ไม่ใช่จากวันนี้ — ไม่งั้นทดสอบย้อนวันแล้วได้ตารางของวันอื่น
  const dayCode = payload.day || dayCodeForDate(date);

  const result = await runDailyDigest(env, { dateIso: date, dayCode, dryRun: payload.dry_run !== false });
  return jsonResponse(result);
}
