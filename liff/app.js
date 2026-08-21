// แก้ค่าด้านล่างก่อน deploy จริง (README "เริ่มงาน (Setup)")
const LIFF_ID = 'REPLACE_ME_LIFF_ID';
const WORKER_BASE_URL = 'REPLACE_ME_WORKER_BASE_URL'; // เช่น https://ram-roo-thang-bot.<subdomain>.workers.dev
const GOOGLE_MAPS_API_KEY = 'REPLACE_ME_GOOGLE_MAPS_API_KEY';

const CONSENT_STORAGE_KEY = 'ram-roo-thang:schedule-consent';

const PARKING_STATUS_LABEL = {
  GREEN: 'ว่าง',
  YELLOW: 'ปานกลาง',
  RED: 'เต็ม',
};

liff.init({ liffId: LIFF_ID, withLoginOnExternalBrowser: true }).then(main).catch((err) => {
  console.error('LIFF init error', err);
  renderError('เปิด LIFF ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
});

function main() {
  const params = new URLSearchParams(window.location.search);

  if (params.has('dest_id')) {
    renderNavigationView(params.get('dest_id'));
  } else if (params.get('mode') === 'profile') {
    renderProfileView();
  } else {
    renderParkingReportView();
  }
}

// --- Shared helpers ---

function getApp() {
  return document.getElementById('app');
}

function renderError(message) {
  getApp().innerHTML = `<div class="card"><p>${message}</p></div>`;
}

async function fetchJSON(path, options) {
  const res = await fetch(`${WORKER_BASE_URL}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'เกิดข้อผิดพลาด');
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

function renderLocationRetry(container, message, onRetry) {
  container.innerHTML = `
    <div class="card">
      <p>${message}</p>
      <button class="btn btn-primary" id="retry-location-btn">ลองอีกครั้ง</button>
    </div>
  `;
  document.getElementById('retry-location-btn').addEventListener('click', onRetry);
}

let cachedUserId = null;
async function getUserId() {
  if (cachedUserId) return cachedUserId;
  const profile = await liff.getProfile();
  // เก็บแค่ userId เท่านั้น — ไม่ใช้/ไม่ส่ง displayName, pictureUrl ต่อ (CONTEXT.md "LINE userId (Session Identifier)")
  cachedUserId = profile.userId;
  return cachedUserId;
}

// Haversine — คู่กับ worker/src/utils.js (ฝั่ง client ใช้หาลานจอดที่ใกล้ที่สุดเท่านั้น
// การตัดสิน geofence จริงยังทำที่ backend เสมอ ตาม MVP-SPEC §6.1)
function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const EARTH_RADIUS_METERS = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function formatExamAt(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

// --- Navigation view (MVP-SPEC §7) ---
// ?dest_id= -> geolocation + GET /api/building + Google Maps Embed mode=directions

async function renderNavigationView(destId) {
  const container = getApp();
  container.innerHTML = '<p>กำลังโหลดข้อมูลอาคาร...</p>';

  let buildingData;
  try {
    buildingData = await fetchJSON(`/api/building?building_id=${encodeURIComponent(destId)}`);
  } catch (err) {
    // MVP-SPEC §8: building_id ไม่พบ -> ตอบสุภาพ อย่า hallucinate ชื่อ/ตำแหน่ง
    renderError('ไม่พบข้อมูลอาคารนี้ครับ กรุณาลองใหม่จากเมนูแชท');
    return;
  }

  const { building, parking_status: parkingStatus } = buildingData;

  const requestLocation = async () => {
    container.innerHTML = '<p>กำลังขอตำแหน่งของคุณ...</p>';
    try {
      const userLocation = await getUserLocation();
      renderNavigationMap(container, building, parkingStatus, userLocation);
    } catch (err) {
      renderLocationRetry(container, 'กรุณาอนุญาตการเข้าถึงตำแหน่งเพื่อดูเส้นทาง', requestLocation);
    }
  };

  await requestLocation();
}

function renderNavigationMap(container, building, parkingStatus, userLocation) {
  const mapSrc =
    `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}` +
    `&origin=${userLocation.lat},${userLocation.lng}` +
    `&destination=${building.lat},${building.lng}` +
    `&mode=walking`;

  const statusLabel = parkingStatus
    ? `${PARKING_STATUS_LABEL[parkingStatus.status] || parkingStatus.status} (${
        parkingStatus.source === 'live_report' ? 'รายงานสด' : 'ค่าประมาณการ'
      })`
    : 'ไม่มีข้อมูล';

  container.innerHTML = `
    <div class="card">
      <h2>${building.name_th}</h2>
      <p class="muted">สถานะที่จอดรถใกล้เคียง: ${statusLabel}</p>
    </div>
    <iframe
      class="map-frame"
      src="${mapSrc}"
      allowfullscreen
      loading="lazy"
      referrerpolicy="no-referrer-when-downgrade"
    ></iframe>
  `;
}

// --- Parking report view (MVP-SPEC §7) ---
// geolocation -> หาลานจอดใกล้ที่สุดจาก /api/buildings + /api/building -> POST /api/parking/report

async function renderParkingReportView() {
  const container = getApp();

  const requestLocation = async () => {
    container.innerHTML = '<p>กำลังขอตำแหน่งของคุณ...</p>';
    try {
      const userLocation = await getUserLocation();
      await loadNearestZoneAndRender(container, userLocation);
    } catch (err) {
      renderLocationRetry(container, 'กรุณาอนุญาตการเข้าถึงตำแหน่งเพื่อรายงานสถานะลานจอด', requestLocation);
    }
  };

  await requestLocation();
}

async function loadNearestZoneAndRender(container, userLocation) {
  container.innerHTML = '<p>กำลังค้นหาลานจอดที่ใกล้ที่สุด...</p>';

  let buildingsData;
  try {
    buildingsData = await fetchJSON('/api/buildings');
  } catch (err) {
    renderError('โหลดข้อมูลลานจอดไม่สำเร็จ กรุณาลองใหม่');
    return;
  }

  const buildings = buildingsData.buildings || [];
  // ดึงพิกัดลานจอดผ่าน /api/building ทีละอาคาร (dedupe ด้วย zone_id กันยิงซ้ำ)
  const buildingIdByZone = new Map(buildings.map((b) => [b.nearest_parking_zone_id, b.building_id]));
  const details = await Promise.all(
    [...buildingIdByZone.values()].map((id) =>
      fetchJSON(`/api/building?building_id=${encodeURIComponent(id)}`).catch(() => null)
    )
  );
  const zones = details.filter(Boolean).map((d) => d.parking_zone).filter(Boolean);

  if (zones.length === 0) {
    renderError('ยังไม่มีข้อมูลลานจอดในระบบครับ');
    return;
  }

  let nearestZone = zones[0];
  let nearestDistance = Infinity;
  for (const zone of zones) {
    const distance = haversineDistanceMeters(userLocation.lat, userLocation.lng, zone.lat, zone.lng);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestZone = zone;
    }
  }

  renderParkingReportForm(container, nearestZone, userLocation);
}

function renderParkingReportForm(container, zone, userLocation) {
  container.innerHTML = `
    <div class="card">
      <h2>${zone.zone_name}</h2>
      <p class="muted">แตะเพื่อรายงานสถานะปัจจุบัน (ต้องอยู่ใกล้ลานจอดจริง)</p>
      <div class="status-buttons">
        <button class="btn btn-status" data-status="GREEN">🟢 ว่าง</button>
        <button class="btn btn-status" data-status="YELLOW">🟡 ปานกลาง</button>
        <button class="btn btn-status" data-status="RED">🔴 เต็ม</button>
      </div>
      <p id="report-result" class="muted"></p>
    </div>
  `;

  container.querySelectorAll('.btn-status').forEach((btn) => {
    btn.addEventListener('click', () => submitParkingReport(zone.zone_id, btn.dataset.status, userLocation));
  });
}

async function submitParkingReport(zoneId, status, userLocation) {
  const resultEl = document.getElementById('report-result');
  resultEl.textContent = 'กำลังส่งรายงาน...';

  try {
    const userId = await getUserId();
    await fetchJSON('/api/parking/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        zone_id: zoneId,
        status,
        user_lat: userLocation.lat,
        user_lng: userLocation.lng,
      }),
    });
    resultEl.textContent = 'รายงานสำเร็จ ขอบคุณครับ';
  } catch (err) {
    // MVP-SPEC §6.1: 429 รายงานถี่เกิน, 422 อยู่ไกลเกินไป
    if (err.status === 429) {
      resultEl.textContent = 'คุณรายงานถี่เกินไป กรุณารออีกสักครู่';
    } else if (err.status === 422) {
      resultEl.textContent = 'คุณอยู่ไกลจากลานจอดนี้เกินไป';
    } else {
      resultEl.textContent = 'ส่งรายงานไม่สำเร็จ กรุณาลองใหม่';
    }
  }
}

// --- Profile view (MVP-SPEC §7, docs/adr/0003) ---
// ?mode=profile -> consent gate (localStorage) -> ฟอร์มบันทึกวิชาสอบ + ลิสต์/ลบ

function renderProfileView() {
  const container = getApp();
  const hasConsent = localStorage.getItem(CONSENT_STORAGE_KEY) === 'true';
  if (hasConsent) {
    renderScheduleView(container);
  } else {
    renderConsentGate(container);
  }
}

function renderConsentGate(container) {
  // UI acknowledgment เฉยๆ ไม่ใช่ PDPA consent flow ตามกฎหมาย เพราะไม่มี PII ให้ขอความยินยอม
  // (CONTEXT.md "Consent Gate (Lightweight)")
  container.innerHTML = `
    <div class="card">
      <h2>บันทึกวิชาสอบ</h2>
      <p>ฟีเจอร์นี้เก็บแค่ รหัสวิชา อาคาร และเวลาสอบ ผูกกับบัญชี LINE ของคุณเท่านั้น ไม่เก็บชื่อหรือเบอร์โทร</p>
      <button class="btn btn-primary" id="consent-accept-btn">เข้าใจแล้ว ใช้งานต่อ</button>
    </div>
  `;
  document.getElementById('consent-accept-btn').addEventListener('click', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, 'true');
    renderScheduleView(container);
  });
}

async function renderScheduleView(container) {
  container.innerHTML = '<p>กำลังโหลด...</p>';

  let userId;
  try {
    userId = await getUserId();
  } catch (err) {
    renderError('โหลดข้อมูลผู้ใช้ไม่สำเร็จ กรุณาเปิดใหม่จากแชท');
    return;
  }

  let buildingsData;
  try {
    buildingsData = await fetchJSON('/api/buildings');
  } catch (err) {
    buildingsData = { buildings: [] };
  }

  renderScheduleForm(container, userId, buildingsData.buildings || []);
  await refreshScheduleList(userId);
}

function renderScheduleForm(container, userId, buildings) {
  const options = buildings.map((b) => `<option value="${b.building_id}">${b.name_th}</option>`).join('');

  container.innerHTML = `
    <div class="card">
      <h2>บันทึกวิชาสอบ</h2>
      <form id="schedule-form">
        <label>รหัสวิชา
          <input type="text" name="course_code" required />
        </label>
        <label>อาคารสอบ
          <select name="building_id" required>
            <option value="" disabled selected>เลือกอาคาร</option>
            ${options}
          </select>
        </label>
        <label>วันเวลาสอบ
          <input type="datetime-local" name="exam_at" required />
        </label>
        <button type="submit" class="btn btn-primary">บันทึก</button>
      </form>
      <p id="schedule-form-result" class="muted"></p>
    </div>
    <div class="card">
      <h2>วิชาที่บันทึกไว้</h2>
      <ul id="schedule-list"><li class="muted">กำลังโหลด...</li></ul>
    </div>
  `;

  document.getElementById('schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const resultEl = document.getElementById('schedule-form-result');
    resultEl.textContent = 'กำลังบันทึก...';

    try {
      await fetchJSON('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          course_code: formData.get('course_code'),
          building_id: formData.get('building_id'),
          exam_at: new Date(formData.get('exam_at')).toISOString(),
        }),
      });
      resultEl.textContent = 'บันทึกสำเร็จ';
      e.target.reset();
      await refreshScheduleList(userId);
    } catch (err) {
      resultEl.textContent = 'บันทึกไม่สำเร็จ กรุณาลองใหม่';
    }
  });
}

async function refreshScheduleList(userId) {
  const listEl = document.getElementById('schedule-list');
  if (!listEl) return;

  let data;
  try {
    data = await fetchJSON(`/api/schedule?user_id=${encodeURIComponent(userId)}`);
  } catch (err) {
    listEl.innerHTML = '<li class="muted">โหลดรายการไม่สำเร็จ</li>';
    return;
  }

  const schedules = data.schedules || [];
  if (schedules.length === 0) {
    listEl.innerHTML = '<li class="muted">ยังไม่มีรายการที่บันทึกไว้</li>';
    return;
  }

  listEl.innerHTML = schedules
    .map(
      (s) => `
        <li>
          <div>
            <strong>${s.course_code}</strong>
            <div class="muted">${s.building_name || s.building_id} — ${formatExamAt(s.exam_at)}</div>
          </div>
          <button class="btn btn-delete" data-schedule-id="${s.schedule_id}">ลบ</button>
        </li>
      `
    )
    .join('');

  listEl.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await fetchJSON(
          `/api/schedule?user_id=${encodeURIComponent(userId)}&schedule_id=${encodeURIComponent(
            btn.dataset.scheduleId
          )}`,
          { method: 'DELETE' }
        );
        await refreshScheduleList(userId);
      } catch (err) {
        btn.disabled = false;
      }
    });
  });
}
