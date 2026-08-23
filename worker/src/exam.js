// Proactive Exam Alerts — เตือนล่วงหน้าว่าพรุ่งนี้มีสอบวิชาอะไรบ้าง
//
// ทำงานผ่าน Cron Trigger (ดู [triggers] ใน wrangler.toml) และเรียกมือได้จาก
// POST /api/admin/exam-alerts สำหรับทดสอบ/เดโม เพราะช่วงสอบจริงคือ 14-28 ต.ค. 2026
// ซึ่งอยู่หลังวันเดโม cron จะไม่มีอะไรให้ส่งในวันงาน ต้องยิงมือถึงจะเห็นของ
//
// ตารางสอบ import เข้า bundle ตรงๆ จาก data/exam-lookup.json (~55 KB) ไม่ผ่าน KV เพราะเป็น
// ข้อมูลนิ่งทั้งภาคเรียน อ่านจาก KV ทุกครั้งที่ cron ทำงานคือเปลืองโควตาโดยไม่ได้อะไรกลับมา
//
// ข้อจำกัดตอนนี้: ประกาศตารางสอบไม่มีอาคาร/ห้องสอบ ข้อความจึงบอกได้แค่วิชากับคาบ
// พอได้ข้อมูลห้องมาแล้วเติมที่ formatAlertMessage จุดเดียว

// import attribute จำเป็นสำหรับ Node (scripts/dev-api.mjs รันไฟล์นี้ตรงๆ) ส่วน esbuild
// ของ wrangler รองรับอยู่แล้ว — เขียนแบบนี้ใช้ได้ทั้งสองทาง
import examLookup from '../../data/exam-lookup.json' with { type: 'json' };
import { pushToLINE } from './line.js';

// เวลาของแต่ละคาบ ตามประกาศของมหาวิทยาลัย (ผู้ใช้ยืนยัน 23 ส.ค. 2026)
// คาบ A บางวิชาเลิก 12.30 จึงเขียนเป็น 12.00/12.30 ตามประกาศ ไม่ตัดให้เหลือค่าเดียว
// ค่านี้ต้องตรงกับ EXAM_PERIOD_TIME ใน liff/app.js เสมอ ถ้าแก้ต้องแก้ทั้งสองที่
const PERIOD_TIME = { A: '09:30 - 12:00/12.30 น.', B: '14:00 - 16:30 น.' };

const THAI_MONTH_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                         'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// LINE จำกัดจำนวนผู้รับต่อการเรียก multicast และเราส่งข้อความไม่เหมือนกันในแต่ละคน
// จึงต้องยิงทีละคน — หน่วงเป็นชุดกัน rate limit ของ Messaging API
const PUSH_BATCH_SIZE = 20;

export function bangkokDate(at = Date.now()) {
  return new Date(at + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function formatThaiDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${THAI_MONTH_ABBR[month - 1]} ${String(year + 543).slice(-2)}`;
}

// รหัสวิชาทั้งหมดที่สอบวันนั้น -> Map<course_code, periods[]>
function coursesOnDate(examDate) {
  const map = new Map();
  for (const [code, value] of Object.entries(examLookup.courses)) {
    if (value && value.slice(0, 10) === examDate) {
      map.set(code, value.slice(10).split(''));
    }
  }
  return map;
}

function formatAlertMessage(examDate, items, liffUrl) {
  // เรียงตามคาบก่อน แล้วค่อยรหัสวิชา — คนอ่านจะได้เห็นวิชาที่สอบเช้าขึ้นก่อน
  const sorted = [...items].sort((a, b) =>
    (a.periods[0] || '').localeCompare(b.periods[0] || '') || a.code.localeCompare(b.code));

  const lines = sorted.map((it) => {
    const time = it.periods.map((p) => PERIOD_TIME[p] || `คาบ ${p}`).join(' และ ');
    // ห้องสอบยังไม่มีในประกาศ — บอกตามจริง ไม่เดา
    return `• ${it.code}\n  ${time}`;
  });

  const count = sorted.length === 1 ? '1 วิชา' : `${sorted.length} วิชา`;
  const profileUrl = liffUrl ? `${liffUrl}${liffUrl.includes('?') ? '&' : '?'}mode=profile` : '';
  return [
    `พรุ่งนี้มีสอบ ${count}นะครับ`,
    formatThaiDate(examDate),
    '',
    lines.join('\n'),
    '',
    // เตือนกฎเข้าสายทุกครั้ง เพราะเป็นข้อที่พลาดแล้วเสียหายที่สุด — สายเกิน 30 นาทีคือหมดสิทธิ์สอบ
    'อย่าลืมไปถึงก่อนเวลา เข้าสายเกิน 30 นาทีหลังเริ่มสอบจะเข้าห้องไม่ได้นะครับ',
    'ห้องสอบเช็กจากตารางสอบรายบุคคลใน e-Service ของมหาวิทยาลัยอีกทีนะครับ',
    profileUrl ? `\nดูตารางสอบทั้งหมด\n${profileUrl}` : '',
  ].join('\n').trimEnd();
}

// รวบรวมว่าใครต้องได้รับข้อความอะไรบ้างสำหรับวันสอบหนึ่งวัน
// แยกจากการส่งจริง เพื่อให้ dry-run ใช้โค้ดเส้นทางเดียวกันเป๊ะ ไม่ใช่คนละทางแล้วเทสไม่ตรงของจริง
export async function collectAlerts(env, examDate) {
  const examCourses = coursesOnDate(examDate);
  if (examCourses.size === 0) return [];

  // จำนวนแถวระดับ (ผู้ใช้ x วิชาที่บันทึก) ซึ่งเล็กมาก ดึงมากรองใน JS ง่ายกว่าและไม่ต้องกังวล
  // เพดานจำนวน bound parameter ของ IN (...) ที่อาจมีเป็นร้อยรหัสต่อวันสอบ
  const { results } = await env.DB.prepare(
    'SELECT user_id, course_code FROM user_courses'
  ).all();

  const byUser = new Map();
  for (const row of results || []) {
    const periods = examCourses.get(row.course_code);
    if (!periods) continue;
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push({ code: row.course_code, periods });
  }

  return [...byUser.entries()].map(([userId, items]) => ({
    userId,
    examDate,
    courses: items.map((i) => i.code).sort(),
    message: formatAlertMessage(examDate, items, env.LIFF_URL),
  }));
}

// ส่งจริง — บันทึกลง exam_alerts_sent ก่อนยิง LINE เสมอ
//
// ลำดับนี้ตั้งใจ: ถ้าบันทึกก่อนแล้วส่งพลาด ผู้ใช้แค่ไม่ได้รับข้อความรอบนั้น แต่ถ้าส่งก่อนแล้ว
// บันทึกพลาด รอบถัดไปจะส่งซ้ำ ระหว่างสองแบบนี้ "ไม่ได้รับ" เสียหายน้อยกว่า "ได้รับซ้ำๆ"
// ซึ่งกวนผู้ใช้และกิน quota ข้อความของ LINE OA ที่มีจำกัด
export async function runExamAlerts(env, { examDate, kind = 'DAY_BEFORE', dryRun = false }) {
  const alerts = await collectAlerts(env, examDate);
  const summary = { examDate, kind, dryRun, candidates: alerts.length, sent: 0, skipped: 0, failed: 0 };

  if (dryRun) {
    return { ...summary, preview: alerts.slice(0, 3).map((a) => ({ courses: a.courses, message: a.message })) };
  }

  for (let i = 0; i < alerts.length; i += PUSH_BATCH_SIZE) {
    const batch = alerts.slice(i, i + PUSH_BATCH_SIZE);
    await Promise.all(batch.map(async (alert) => {
      let claimed;
      try {
        claimed = await env.DB.prepare(
          `INSERT INTO exam_alerts_sent (user_id, exam_date, kind, courses, sent_at)
           VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, exam_date, kind) DO NOTHING`
        ).bind(alert.userId, examDate, kind, alert.courses.join(','), new Date().toISOString()).run();
      } catch (err) {
        console.error('exam alert: บันทึกไม่สำเร็จ', err);
        summary.failed += 1;
        return;
      }

      // changes = 0 แปลว่าเคยส่งไปแล้ว
      if (!claimed.meta || claimed.meta.changes === 0) {
        summary.skipped += 1;
        return;
      }

      try {
        await pushToLINE(alert.userId, [{ type: 'text', text: alert.message }], env.LINE_CHANNEL_ACCESS_TOKEN);
        summary.sent += 1;
      } catch (err) {
        summary.failed += 1;
        console.error('exam alert: ส่ง LINE ไม่สำเร็จ', alert.userId, err);

        // ถอนการจองคืนเฉพาะกรณีที่ลองใหม่แล้วมีโอกาสสำเร็จ (5xx หรือเน็ตพัง)
        // ถ้าเป็น 4xx เช่นผู้ใช้บล็อก OA ไปแล้ว ปล่อยแถวไว้ จะได้ไม่ยิงซ้ำทุกวันจนเปลืองโควตา
        const retriable = !err.status || err.status >= 500;
        if (retriable) {
          summary.retriable = (summary.retriable || 0) + 1;
          await env.DB.prepare(
            'DELETE FROM exam_alerts_sent WHERE user_id = ? AND exam_date = ? AND kind = ?'
          ).bind(alert.userId, examDate, kind).run().catch((e) => console.error('rollback ไม่สำเร็จ', e));
        }
      }
    }));
  }

  return summary;
}

// Cron เรียกตัวนี้ — เตือนล่วงหน้าหนึ่งวันเสมอ
export async function runDailyExamAlerts(env) {
  const tomorrow = bangkokDate(Date.now() + 24 * 3600 * 1000);
  const result = await runExamAlerts(env, { examDate: tomorrow, kind: 'DAY_BEFORE' });
  console.log('exam alerts:', JSON.stringify(result));
  return result;
}

// POST /api/admin/exam-alerts — ยิงมือสำหรับทดสอบ/เดโม
//   body: { date: 'YYYY-MM-DD', dry_run: true }
//   header: x-admin-token
//
// ต้องมี token เพราะ endpoint นี้ส่งข้อความหาผู้ใช้จริงได้ ปล่อยเปิดไว้ไม่ได้เด็ดขาด
// dry_run ก็ยังต้องใช้ token เพราะผลลัพธ์มีตัวอย่างข้อความและจำนวนผู้ใช้ติดไปด้วย
export async function handleAdminExamAlerts(request, env) {
  const token = request.headers.get('x-admin-token');
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch { /* ไม่มี body ก็ได้ ใช้ค่าเริ่มต้น */ }

  const examDate = payload.date || bangkokDate(Date.now() + 24 * 3600 * 1000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
    return new Response(JSON.stringify({ error: 'date ต้องเป็นรูปแบบ YYYY-MM-DD' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await runExamAlerts(env, {
    examDate,
    kind: payload.kind || 'DAY_BEFORE',
    dryRun: payload.dry_run !== false,   // ต้องระบุ dry_run: false ชัดเจนถึงจะส่งจริง
  });

  return new Response(JSON.stringify(result), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
