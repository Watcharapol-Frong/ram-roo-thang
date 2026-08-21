// POST/GET/DELETE /api/schedule — บันทึกวิชาสอบ ไม่มี PII
// MVP-SPEC-for-Dev.md §6.5-6.7, docs/adr/0003, CONTEXT.md "Student Exam Schedule (No-PII)"
// ผูกกับ LINE userId เท่านั้น ไม่เก็บชื่อ/เบอร์โทร

import { putSchedule, listSchedulesForUser, deleteSchedule, getBuildingByKey } from './data.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handlePostSchedule(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { user_id, course_code, building_id, exam_at } = payload;
  if (!user_id || !course_code || !building_id || !exam_at) {
    return jsonResponse({ error: 'Missing required fields' }, 400);
  }

  const building = await getBuildingByKey(env, building_id);
  if (!building) {
    return jsonResponse({ error: 'ไม่พบข้อมูลอาคารนี้' }, 404);
  }

  const schedule = {
    schedule_id: crypto.randomUUID(),
    course_code,
    building_id,
    exam_at,
  };
  await putSchedule(env, user_id, schedule);

  return jsonResponse({ status: 'SUCCESS', schedule });
}

export async function handleGetSchedule(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  if (!userId) {
    return jsonResponse({ error: 'ต้องระบุ user_id' }, 400);
  }

  const schedules = await listSchedulesForUser(env, userId);

  // เติม building_name ตาม response shape ใน MVP-SPEC §6.6 (ไม่เก็บซ้ำใน schedule object เอง)
  const enriched = await Promise.all(
    schedules.map(async (s) => {
      const building = await getBuildingByKey(env, s.building_id);
      return { ...s, building_name: building ? building.name_th : null };
    })
  );

  return jsonResponse({ schedules: enriched });
}

export async function handleDeleteSchedule(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  const scheduleId = url.searchParams.get('schedule_id');
  if (!userId || !scheduleId) {
    return jsonResponse({ error: 'ต้องระบุ user_id และ schedule_id' }, 400);
  }

  await deleteSchedule(env, userId, scheduleId);
  return jsonResponse({ status: 'SUCCESS' });
}
