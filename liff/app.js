// แก้ค่าด้านล่างก่อน deploy จริง (README "เริ่มงาน (Setup)")
const LIFF_ID = '2011201463-2rdSwrwB';
const PROD_WORKER_BASE_URL = 'https://ram-roo-thang-bot.frongbook.workers.dev';
const GOOGLE_MAPS_API_KEY = 'AIzaSyAkKFL6P004xrx5mPR4Q1NXlCsy6MePTIE';

// Vector Map ID — บังคับต้องมี ถ้าอยากได้มุมมอง 3D จริง เพราะแผนที่แบบ raster เอียง (tilt) ได้เฉพาะ
// พื้นที่ที่ Google มีภาพถ่ายมุม 45° ซึ่งย่านรามคำแหงไม่มี จึงกดปุ่ม 3D แล้วไม่มีอะไรเกิดขึ้น
// DEMO_MAP_ID ใช้ทดสอบได้ทันที แต่ก่อน demo จริงควรสร้าง Map ID ของตัวเองใน Google Cloud Console
// (Google Maps Platform > Map management > Create map ID, Map type = JavaScript, Rendering = Vector)
// เพราะ Map ID ของตัวเองตั้งสไตล์/ซ่อน POI ที่ไม่เกี่ยวกับมหาลัยได้ ส่วน DEMO_MAP_ID ตั้งไม่ได้
const GOOGLE_MAPS_MAP_ID = 'DEMO_MAP_ID';

// Dev Mode (?dev=1) — เปิดทดสอบบนเบราว์เซอร์ปกติได้โดยไม่ต้องเปิดผ่านแอป LINE
// ปกติ liff.init จะเด้งไปหน้า LINE Login ทำให้เทสยาก โหมดนี้จึง stub liff ทิ้งไปเลย
// และจำลองพิกัด GPS ให้อยู่ในแคมปัส (ใส่ &lat=&lng= เพื่อจำลองตำแหน่งอื่น เช่น นอกแคมปัส)
//
// ⚠️ จำกัดไว้เฉพาะ localhost เท่านั้น — บน production ?dev=1 ต้องไม่มีผลใดๆ ไม่งั้นใครก็ตาม
// ที่เปิด LIFF URL แล้วเติม ?dev=1&lat=&lng= จะข้าม LINE login และ "ปลอมพิกัด" ให้ผ่าน
// geofence ของ POST /api/parking/report ได้จากเบราว์เซอร์ธรรมดา
const DEV_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]', ''];
const DEV_MODE =
  new URLSearchParams(window.location.search).has('dev') &&
  DEV_HOSTNAMES.includes(window.location.hostname);

// ชี้ backend ไปที่อื่นได้ด้วย ?api= แต่เฉพาะใน DEV_MODE (= localhost) เท่านั้น — ใช้ตอนรัน
// backend ในเครื่องคู่กับ LIFF (ดู scripts/dev-api.mjs) จะได้ไม่ต้องแก้ค่าคงที่ในไฟล์นี้ไปมา
// บน production ค่านี้ล็อกเป็น PROD_WORKER_BASE_URL เสมอ ผู้ใช้ทั่วไปเปลี่ยนปลายทาง API ไม่ได้
const WORKER_BASE_URL = DEV_MODE
  ? new URLSearchParams(window.location.search).get('api') || PROD_WORKER_BASE_URL
  : PROD_WORKER_BASE_URL;

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

// LIFF SDK กับ Google Maps เป็น dependency ภายนอกคนละตัว โหลดขนานกัน และ "พังแยกกันได้"
// เดิมหน้าเว็บรอให้พร้อมทั้งคู่ก่อนถึงจะเริ่ม main() ตัวไหนพังก็ตายทั้งหน้า ทั้งที่บันทึกวิชาสอบกับ
// รายงานลานจอดไม่ได้ใช้ Google Maps เลย และหน้าแผนที่ก็ไม่ต้องใช้ LIFF profile จนกว่าจะกดส่งรายงาน
// ตอนนี้แต่ละ view รอเฉพาะ dependency ของตัวเอง (ดู getUserId / renderMapView)
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => {}); // กัน unhandled rejection ตอนที่ยังไม่มี view ไหน await อยู่
  return { promise, resolve, reject };
};

const liffBoot = deferred();
const mapsBoot = deferred();

// Google Maps ค้างแบบไม่ error ก็มี (โหลดสคริปต์ได้แต่ callback ไม่ยิง เช่น key ถูกจำกัด referrer)
// ตั้งเพดานไว้ ไม่งั้นหน้าแผนที่จะหมุนค้างตลอดกาลโดยไม่บอกอะไรผู้ใช้เลย
const MAPS_LOAD_TIMEOUT_MS = 10000;
setTimeout(() => mapsBoot.reject(new Error('Google Maps โหลดไม่ทันเวลา')), MAPS_LOAD_TIMEOUT_MS);

if (DEV_MODE) {
  window.liff = { getProfile: async () => ({ userId: 'DEV_USER' }) };
  liffBoot.resolve();
} else {
  // ครอบ try/catch เพราะถ้า sdk.js (static.line-scdn.net) โหลดไม่ขึ้น ตัวแปร liff จะไม่มีอยู่จริง
  // บรรทัดนี้จะ throw ReferenceError กลางไฟล์ ทำให้โค้ดที่เหลือ "ทั้งไฟล์" ไม่ถูกรันเลย
  // (รวมถึง loadGoogleMaps ท้ายไฟล์) ผลคือหน้าค้างที่ "กำลังโหลด..." เงียบๆ ไม่มีข้อความบอก
  try {
    liff
      .init({ liffId: LIFF_ID, withLoginOnExternalBrowser: true })
      .then(() => liffBoot.resolve())
      .catch((err) => {
        console.error('LIFF init error', err);
        liffBoot.reject(err);
      });
  } catch (err) {
    console.error('โหลด LIFF SDK ไม่สำเร็จ', err);
    liffBoot.reject(err);
  }
}

// Google Maps JS API เรียกชื่อนี้เองหลังโหลดสคริปต์เสร็จ (ดู loadGoogleMaps ท้ายไฟล์)
function initApp() {
  mapsBoot.resolve();
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
  if (DEV_MODE) {
    const params = new URLSearchParams(window.location.search);
    const lat = Number.parseFloat(params.get('lat'));
    const lng = Number.parseFloat(params.get('lng'));
    if (Number.isFinite(lat) && Number.isFinite(lng)) return Promise.resolve({ lat, lng });
    const hub = CAMPUS_CONSTANTS.DEFAULT_ORIGIN;
    return Promise.resolve({ lat: hub.lat, lng: hub.lng });
  }
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
  await liffBoot.promise; // throw ต่อถ้า LIFF ใช้ไม่ได้ — ผู้เรียกจัดการแสดงข้อความเอง
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

  // เฉพาะ view นี้เท่านั้นที่ต้องมี Google Maps — ถ้าโหลดไม่ขึ้นให้เหลือทางไป view อื่นที่ยังใช้ได้
  try {
    await mapsBoot.promise;
  } catch (err) {
    console.error('Google Maps ใช้งานไม่ได้', err);
    renderMapUnavailable();
    return;
  }

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

  buildingMarkers.length = 0;
  appState.map.instance = new google.maps.Map(document.getElementById('map'), {
    center: CAMPUS_CONSTANTS.INITIAL_VIEW.center,
    zoom: CAMPUS_CONSTANTS.INITIAL_VIEW.zoom,
    mapId: GOOGLE_MAPS_MAP_ID,
    disableDefaultUI: true,
    zoomControl: true,
    clickableIcons: false,
  });
  RouteCalculator.init(appState.map.instance);
  appState.map.instance.addListener('center_changed', updateLayerToggleAvailability);
  appState.map.instance.addListener('zoom_changed', updateBuildingMarkerVisibility);
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
  await placeParkingMarkers();

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

// หมุดอาคารเป็น "ป้ายชิป" เล็กๆ ที่มีรหัสอาคารอยู่ข้างใน แทนหมุดสีแดงมาตรฐานของ Google —
// อาคาร 35 หลังในพื้นที่ ~1 ตร.กม. ถ้าใช้หมุดมาตรฐานจะบังกันจนมองไม่เห็นตัวแผนที่เลย
const BUILDING_MARKER_MIN_ZOOM = 16;
const buildingMarkers = [];

function escapeXml(text) {
  return String(text).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

function buildingMarkerIcon(code, isSelected) {
  const label = escapeXml(code);
  const width = Math.max(30, label.length * 8 + 16);
  const fill = isSelected ? '#06c755' : '#ffffff';
  const stroke = isSelected ? '#06c755' : '#c9cfd6';
  const textColor = isSelected ? '#ffffff' : '#26313d';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24">`
    + `<rect x="0.5" y="0.5" width="${width - 1}" height="23" rx="11.5" fill="${fill}" stroke="${stroke}"/>`
    + `<text x="${width / 2}" y="16" text-anchor="middle" font-family="-apple-system,Segoe UI,sans-serif"`
    + ` font-size="11" font-weight="600" fill="${textColor}">${label}</text></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    anchor: new google.maps.Point(width / 2, 12),
  };
}

function placeBuildingMarkers(buildings) {
  buildings.forEach((b) => {
    const marker = new google.maps.Marker({
      position: { lat: b.lat, lng: b.lng },
      map: appState.map.instance,
      title: b.name_th,
      icon: buildingMarkerIcon(b.building_id, false),
    });
    marker.buildingId = b.building_id;
    marker.addListener('click', () => {
      selectTarget({ id: b.building_id, name: b.name_th, type: 'BUILDING', coords: { lat: b.lat, lng: b.lng } });
    });
    buildingMarkers.push(marker);
  });
  updateBuildingMarkerVisibility();
}

// ซูมออกไกลๆ ป้ายชิปจะทับกันเป็นพืด ซ่อนไปเลยดีกว่า เหลือแต่หมุดลานจอดที่มีไม่กี่จุด
function updateBuildingMarkerVisibility() {
  const map = appState.map.instance;
  if (!map) return;
  const visible = map.getZoom() >= BUILDING_MARKER_MIN_ZOOM;
  buildingMarkers.forEach((marker) => marker.setVisible(visible));
}

function highlightBuildingMarker(buildingId) {
  buildingMarkers.forEach((marker) => {
    marker.setIcon(buildingMarkerIcon(marker.buildingId, marker.buildingId === buildingId));
    marker.setZIndex(marker.buildingId === buildingId ? 100 : 1);
  });
}

// สีหมุดลานจอด = สถานะความหนาแน่นปัจจุบัน (เขียว/เหลือง/แดง) ตาม §1
// ดึงทุกโซนจาก /api/parking/zones ครั้งเดียว (เดิมยิง /api/parking/zone ทีละโซนตาม
// nearest_parking_zone_id ของอาคาร = 8 request ต่อการเปิดแผนที่ 1 ครั้ง) — ผลพลอยได้คือ
// โซนที่ยังไม่มีอาคารไหนอ้างถึงก็ขึ้นหมุดด้วย ซึ่งถูกต้องกว่าเดิมสำหรับหน้าแผนที่รวม
async function placeParkingMarkers() {
  let zonesData;
  try {
    zonesData = await fetchJSON('/api/parking/zones');
  } catch (err) {
    console.error('โหลดข้อมูลลานจอดไม่สำเร็จ', err);
    return;
  }

  (zonesData.zones || []).forEach(({ zone, parking_status: parkingStatus }) => {
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

// Maps ล่ม (เน็ตสะดุด / key เกิน quota / referrer ไม่ผ่าน) — ยังต้องกดไปหน้าที่จอดรถได้
// เพราะการรายงานลานจอดไม่ได้ใช้ Google Maps เลย จึงคง mode bar ไว้เสมอ
function renderMapUnavailable() {
  const container = getApp();
  container.innerHTML = `
    <div class="card">
      <h2>แผนที่ใช้งานไม่ได้ชั่วคราว</h2>
      <p class="muted">โหลด Google Maps ไม่สำเร็จ อาจเป็นเพราะสัญญาณอินเทอร์เน็ต — เมนูอื่นยังใช้งานได้ตามปกติครับ</p>
      <button class="btn btn-primary" id="maps-retry-btn">ลองโหลดใหม่</button>
    </div>
  `;
  document.getElementById('maps-retry-btn').addEventListener('click', () => window.location.reload());
  renderModeBar(container, 'nav');
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

// เปิด 3D ได้เฉพาะตอนศูนย์กลางแผนที่อยู่ในรั้ว ม.รามฯ เท่านั้น (AC-05) — ใช้อาคาร 3D ของ Google เอง
// จาก vector map (ดู GOOGLE_MAPS_MAP_ID) ไม่ต้องดูแลข้อมูลรูปทรง/ความสูงตึกเองเลย
function toggle3D() {
  const btn = document.getElementById('layer-toggle-btn');
  if (!btn || btn.disabled || !appState.map.instance) return;
  appState.map.is3DMode = !appState.map.is3DMode;
  applyViewMode();
  btn.textContent = appState.map.is3DMode ? '🗺 กลับสู่ 2D' : '🏢 เปิดมุมมอง 3D';
}

// อาคาร 3D ของ Google โผล่เฉพาะตอนซูมใกล้พอ (~18 ขึ้นไป) ถ้าเอียงกล้องตอนซูมออกจะได้แค่พื้นเอียงเปล่าๆ
const MIN_3D_ZOOM = 18;

function applyViewMode() {
  const map = appState.map.instance;
  if (appState.map.is3DMode) {
    if (map.getZoom() < MIN_3D_ZOOM) map.setZoom(MIN_3D_ZOOM);
    map.setTilt(47.5);
    map.setHeading(20);
  } else {
    map.setTilt(0);
    map.setHeading(0);
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
  highlightBuildingMarker(target.type === 'BUILDING' ? target.id : null);
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
// geolocation -> หาลานจอดใกล้ที่สุดจาก /api/parking/zones -> POST /api/parking/report

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

  // /api/parking/zones คืนทุกโซนพร้อมพิกัดในคำขอเดียว — เดิมต้องวน /api/buildings แล้วยิง
  // /api/building ต่ออีกโซนละครั้ง เพียงเพื่อเอา parking_zone.lat/lng มาหาโซนที่ใกล้ที่สุด
  let zonesData;
  try {
    zonesData = await fetchJSON('/api/parking/zones');
  } catch (err) {
    renderError('โหลดข้อมูลลานจอดไม่สำเร็จ กรุณาลองใหม่');
    return;
  }

  const zones = (zonesData.zones || []).map((entry) => entry.zone).filter(Boolean);

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
  script.onerror = () => mapsBoot.reject(new Error('โหลดสคริปต์ Google Maps ไม่สำเร็จ'));
  document.head.appendChild(script);
})();

// เริ่มที่ท้ายไฟล์ เพราะ main() อ่านค่าคงที่/สถานะที่ประกาศไว้ด้านบนทั้งหมด — และเริ่มได้ทันที
// ไม่ต้องรอ dependency ภายนอกตัวไหนแล้ว (แต่ละ view รอเองตามที่ตัวเองต้องใช้)
main();
