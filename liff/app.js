// แก้ค่าด้านล่างก่อน deploy จริง (README "เริ่มงาน (Setup)")
const LIFF_ID = '2011201463-2rdSwrwB';
const WORKER_BASE_URL = 'https://ram-roo-thang-bot.frongbook.workers.dev';
const GOOGLE_MAPS_API_KEY = 'REPLACE_ME_GOOGLE_MAPS_API_KEY';

const CONSENT_STORAGE_KEY = 'ram-roo-thang:schedule-consent';

// Module 2: Context-Aware Map & Navigation Engine (Module_2_Technical_Specification.md §2) —
// single source of truth ของพิกัดมาตรฐาน ทั้งหมดในไฟล์นี้อ้างอิงจากตรงนี้ที่เดียว
const CAMPUS_CONSTANTS = {
  DEFAULT_ORIGIN: {
    lat: 13.758915516230301,
    lng: 100.61822407295021,
    googleMapsUrl: 'https://maps.app.goo.gl/2Vb7uyvJAbz62az89',
  },
  GEOFENCE: { minLat: 13.7510, maxLat: 13.7610, minLng: 100.6120, maxLng: 100.6250 },
  INITIAL_VIEW: { center: { lat: 13.7565, lng: 100.6185 }, zoom: 17 },
};

const PARKING_STATUS_LABEL = { GREEN: 'ว่าง', YELLOW: 'ปานกลาง', RED: 'เต็ม' };
const PARKING_STATUS_COLOR = { GREEN: '#2ecc71', YELLOW: '#f1c40f', RED: '#e74c3c' };

// Global State Architecture (Module_2_Technical_Specification.md §5) — เก็บไว้ให้ฟีเจอร์ในอนาคต
// (Find My Car, Community Map, RU Portal Sync) มีจุดต่อขยายชัดเจน โมดูลนี้ implement แค่ user/target/map
// ตามที่ Acceptance Criteria ต้องการจริงเท่านั้น ไม่ได้ build ฟีเจอร์อนาคตพวกนั้นเต็มรูปแบบ
const appState = {
  user: {
    location: null,
    isInsideCampus: false,
    isGpsAllowed: false,
    lineUserId: null,
  },
  target: null, // { id, name, type: 'BUILDING'|'PARKING'|'MY_CAR'|'COMMUNITY', coords: {lat,lng} }
  map: {
    instance: null,
    is3DMode: false,
    activeTab: 'nav',
  },
};

// LIFF init และ Google Maps script โหลดแบบขนานกันคนละทาง (Google เรียก callback ของตัวเองตอนพร้อม
// ดู index.html) — ต้องรอทั้งคู่เสร็จก่อนค่อยเริ่ม main()
let liffReady = false;
let mapsReady = false;

liff.init({ liffId: LIFF_ID, withLoginOnExternalBrowser: true }).then(() => {
  liffReady = true;
  tryStart();
}).catch((err) => {
  console.error('LIFF init error', err);
  renderError('เปิด LIFF ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
});

// Google Maps JS API เรียกชื่อนี้เองหลังโหลดสคริปต์เสร็จ (script tag ใน index.html มี &callback=initApp)
function initApp() {
  mapsReady = true;
  tryStart();
}

function tryStart() {
  if (liffReady && mapsReady) main();
}

function main() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');

  if (mode === 'profile') {
    renderProfileView();
    return;
  }

  // Flex Message Integration (Module_2_Technical_Specification.md §6)
  // dest_id&mode=nav -> เลือกอาคารให้ทันที, zone_id&mode=parking -> เลือกลานจอดให้ทันที
  // ไม่มี param เลย -> Single Canvas Overview (§1) ให้ผู้ใช้แตะเลือกเองจากแผนที่
  if (params.has('dest_id')) {
    renderMapView({ presetDestId: params.get('dest_id') });
  } else if (mode === 'parking' && params.has('zone_id')) {
    renderMapView({ presetZoneId: params.get('zone_id') });
  } else {
    renderMapView({});
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
  appState.user.lineUserId = cachedUserId;
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

// --- Map view: One-Box Context-Driven Navigation (Module_2_Technical_Specification.md §1-4) ---

function isWithinCampusBounds({ lat, lng }) {
  const g = CAMPUS_CONSTANTS.GEOFENCE;
  return lat >= g.minLat && lat <= g.maxLat && lng >= g.minLng && lng <= g.maxLng;
}

async function renderMapView({ presetDestId, presetZoneId }) {
  const container = getApp();
  container.innerHTML = `
    <div class="map-container">
      <div id="map"></div>
      <div id="notice-bar-slot"></div>
      <button class="layer-toggle-btn" id="layer-toggle-btn">🏢 เปิดมุมมอง 3D</button>
      <div id="action-sheet-slot"></div>
    </div>
  `;
  renderModeBar(container, 'nav');
  document.getElementById('layer-toggle-btn').addEventListener('click', toggle3D);

  appState.map.instance = new google.maps.Map(document.getElementById('map'), {
    center: CAMPUS_CONSTANTS.INITIAL_VIEW.center,
    zoom: CAMPUS_CONSTANTS.INITIAL_VIEW.zoom,
    mapTypeId: 'roadmap',
    disableDefaultUI: true,
    zoomControl: true,
    mapTypeControl: false,
  });
  RouteCalculator.init(appState.map.instance);
  appState.map.instance.addListener('center_changed', updateLayerToggleAvailability);
  updateLayerToggleAvailability();

  let buildingsData;
  try {
    buildingsData = await fetchJSON('/api/buildings');
  } catch (err) {
    renderError('โหลดข้อมูลอาคารไม่สำเร็จ กรุณาลองใหม่');
    return;
  }
  const buildings = buildingsData.buildings || [];
  placeBuildingMarkers(buildings);
  await placeParkingMarkers(buildings);

  if (presetDestId) {
    const building = buildings.find((b) => b.building_id === presetDestId);
    if (!building) {
      renderError('ไม่พบข้อมูลอาคารนี้ครับ กรุณาลองใหม่จากเมนูแชท');
      return;
    }
    await selectTarget({ id: building.building_id, name: building.name_th, type: 'BUILDING', coords: { lat: building.lat, lng: building.lng } });
  } else if (presetZoneId) {
    let zoneData;
    try {
      zoneData = await fetchJSON(`/api/parking/zone?zone_id=${encodeURIComponent(presetZoneId)}`);
    } catch (err) {
      renderError('ไม่พบข้อมูลลานจอดนี้ครับ กรุณาลองใหม่จากเมนูแชท');
      return;
    }
    await selectTarget({ id: zoneData.zone.zone_id, name: zoneData.zone.zone_name, type: 'PARKING', coords: { lat: zoneData.zone.lat, lng: zoneData.zone.lng } });
  }
}

function placeBuildingMarkers(buildings) {
  buildings.forEach((b) => {
    const marker = new google.maps.Marker({
      position: { lat: b.lat, lng: b.lng },
      map: appState.map.instance,
      title: b.name_th,
    });
    marker.addListener('click', () => {
      selectTarget({ id: b.building_id, name: b.name_th, type: 'BUILDING', coords: { lat: b.lat, lng: b.lng } });
    });
  });
}

// สีหมุดลานจอด = สถานะความหนาแน่นปัจจุบัน (เขียว/เหลือง/แดง) ตาม §1 — ดึงทีละ zone ที่ไม่ซ้ำกัน
// (หลายอาคารอาจแชร์ zone เดียวกัน dedupe ด้วย nearest_parking_zone_id กันยิง fetch ซ้ำ)
async function placeParkingMarkers(buildings) {
  const uniqueZoneIds = [...new Set(buildings.map((b) => b.nearest_parking_zone_id).filter(Boolean))];
  const zoneDetails = await Promise.all(
    uniqueZoneIds.map((id) => fetchJSON(`/api/parking/zone?zone_id=${encodeURIComponent(id)}`).catch(() => null))
  );

  zoneDetails.filter(Boolean).forEach(({ zone, parking_status: parkingStatus }) => {
    const status = (parkingStatus && parkingStatus.status) || zone.baseline_status;
    const marker = new google.maps.Marker({
      position: { lat: zone.lat, lng: zone.lng },
      map: appState.map.instance,
      title: `${zone.zone_name} (${PARKING_STATUS_LABEL[status] || status})`,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: PARKING_STATUS_COLOR[status] || '#999999',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
    });
    marker.addListener('click', () => {
      selectTarget({ id: zone.zone_id, name: zone.zone_name, type: 'PARKING', coords: { lat: zone.lat, lng: zone.lng } });
    });
  });
}

// Bottom Mode Selector Bar — แปะท้ายทุกหน้าในกลุ่มแผนที่/ที่จอดรถ "ร้านค้า/ซุ้ม" ยังไม่มี POI
// submission/moderation backend (docs/adr/0004, MVP-SPEC §9 Out of Scope) จึงมีแค่ tab โชว์ empty
// state เฉยๆ ไม่ได้ทำระบบเบื้องหลังเพิ่ม
function renderModeBar(container, activeMode) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="mode-bar">
      <button class="mode-bar-item${activeMode === 'nav' ? ' active' : ''}" data-mode="nav">🗺 นำทาง</button>
      <button class="mode-bar-item${activeMode === 'parking' ? ' active' : ''}" data-mode="parking">🚗 ที่จอดรถ</button>
      <button class="mode-bar-item${activeMode === 'shop' ? ' active' : ''}" data-mode="shop">🍜 ร้านค้า/ซุ้ม</button>
    </div>
  `;
  const bar = wrapper.firstElementChild;
  container.appendChild(bar);

  bar.querySelectorAll('.mode-bar-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === activeMode) return;
      appState.map.activeTab = mode;
      if (mode === 'parking') renderParkingReportView();
      else if (mode === 'shop') renderShopPlaceholderView();
      else if (mode === 'nav') renderMapView({});
    });
  });
}

function renderShopPlaceholderView() {
  const container = getApp();
  container.innerHTML = `
    <div class="card">
      <h2>ร้านค้า/ซุ้ม</h2>
      <p class="muted">ยังไม่มีข้อมูลร้านค้าในระบบครับ (ฟีเจอร์นี้อยู่ระหว่างวางแผน)</p>
    </div>
  `;
  renderModeBar(container, 'shop');
}

// เปิด 3D (Hybrid + Tilt) ได้เฉพาะตอนศูนย์กลางแผนที่อยู่ในรั้ว ม.รามฯ เท่านั้น (AC-05) — ใช้ภาพถ่าย
// ดาวเทียม + มุมเอียงของ Google เอง ไม่ต้องดูแลข้อมูลรูปทรง/ความสูงตึกเองเลย
function toggle3D() {
  const btn = document.getElementById('layer-toggle-btn');
  if (!btn || btn.disabled || !appState.map.instance) return;
  appState.map.is3DMode = !appState.map.is3DMode;
  applyViewMode();
  btn.textContent = appState.map.is3DMode ? '🗺 กลับสู่ 2D' : '🏢 เปิดมุมมอง 3D';
}

function applyViewMode() {
  const map = appState.map.instance;
  if (appState.map.is3DMode) {
    map.setMapTypeId('hybrid');
    map.setTilt(45);
  } else {
    map.setMapTypeId('roadmap');
    map.setTilt(0);
  }
}

function updateLayerToggleAvailability() {
  const btn = document.getElementById('layer-toggle-btn');
  if (!btn || !appState.map.instance) return;
  const center = appState.map.instance.getCenter();
  const allowed = isWithinCampusBounds({ lat: center.lat(), lng: center.lng() });
  btn.disabled = !allowed;
  if (!allowed && appState.map.is3DMode) {
    appState.map.is3DMode = false;
    applyViewMode();
    btn.textContent = '🏢 เปิดมุมมอง 3D';
  }
}

// ผู้ใช้แตะเลือกอาคาร/ลานจอดจากแผนที่ (หรือถูกเลือกให้อัตโนมัติจาก dest_id/zone_id) — จุดเริ่มต้นของ
// Context Routing Matrix (§3) ทั้งหมด
async function selectTarget(target) {
  appState.target = target;
  SheetManager.hide();
  appState.map.instance.panTo(target.coords);

  if (appState.user.isGpsAllowed && appState.user.location) {
    appState.user.isInsideCampus = isWithinCampusBounds(appState.user.location);
    await runContextRouting(target, appState.user.location);
    return;
  }

  try {
    const userLocation = await getUserLocation();
    appState.user.location = userLocation;
    appState.user.isGpsAllowed = true;
    SheetManager.hideGpsWarning();
    appState.user.isInsideCampus = isWithinCampusBounds(userLocation);
    await runContextRouting(target, userLocation);
  } catch (err) {
    appState.user.isGpsAllowed = false;
    handleGpsDenied(target);
  }
}

// Context Routing Matrix (Module_2_Technical_Specification.md §3) — ตัดสินโหมดนำทางจาก
// isInsideCampus + target.type เท่านั้น ตามตารางในสเปกเป๊ะๆ
async function runContextRouting(target, originLocation, opts) {
  if (!appState.user.isInsideCampus) {
    SheetManager.showOffCampusSheet({
      title: target.name,
      onOpenGoogleMaps: () => window.open(CAMPUS_CONSTANTS.DEFAULT_ORIGIN.googleMapsUrl, '_blank'),
    });
    return;
  }

  const travelMode = target.type === 'PARKING' ? 'DRIVING' : 'WALKING';
  try {
    const route = await RouteCalculator.calculateRoute(originLocation, target.coords, travelMode);
    const originNote = opts && opts.isFallbackOrigin ? ' (ประมาณจากประตูหน้า ม.รามฯ)' : '';
    SheetManager.showRouteSheet({
      title: target.name,
      distanceText: route.distanceText,
      durationText: `${route.durationText}${originNote}`,
      actionLabel: travelMode === 'WALKING' ? '🚶 เริ่มนำทางเดินเท้า' : '🚗 เริ่มนำทางขับรถ',
      onAction: () => appState.map.instance.panTo(target.coords),
    });
  } catch (err) {
    console.error('คำนวณเส้นทางไม่สำเร็จ', err);
    RouteCalculator.clearRoute();
    SheetManager.showRouteErrorSheet({
      title: target.name,
      onFocus: () => appState.map.instance.panTo(target.coords),
    });
  }
}

// GPS Denied Fallback (Module_2_Technical_Specification.md §3 แถว Fallback, AC-04) — โชว์แถบเตือน
// พร้อมกับแผนที่ (ไม่ใช่แทนที่กัน) แล้วคำนวณเส้นทางจาก DEFAULT_ORIGIN ให้อัตโนมัติ ไม่ crash
function handleGpsDenied(target) {
  SheetManager.showGpsWarning(() => selectTarget(target));
  appState.user.isInsideCampus = true;
  runContextRouting(target, CAMPUS_CONSTANTS.DEFAULT_ORIGIN, { isFallbackOrigin: true });
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
  renderModeBar(container, 'parking');
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

// โหลด Google Maps JS API script แบบ dynamic (ไม่ผูกไว้ตรงๆ ใน index.html) เพื่อให้ GOOGLE_MAPS_API_KEY
// มี source of truth เดียวอยู่ในไฟล์นี้ — เรียก initApp() (นิยามไว้ด้านบน) เป็น callback เมื่อโหลดเสร็จ
(function loadGoogleMaps() {
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&callback=initApp`;
  script.async = true;
  script.onerror = () => renderError('โหลด Google Maps ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  document.head.appendChild(script);
})();
