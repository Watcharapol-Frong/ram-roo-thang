// แก้ค่าด้านล่างก่อน deploy จริง (README "เริ่มงาน (Setup)")
const LIFF_ID = '2011201463-2rdSwrwB';
const PROD_WORKER_BASE_URL = 'https://ram-roo-thang-bot.frongbook.workers.dev';
const GOOGLE_MAPS_API_KEY = 'AIzaSyAkKFL6P004xrx5mPR4Q1NXlCsy6MePTIE';

// Vector Map ID — บังคับต้องมี ถ้าอยากได้มุมมอง 3D จริง เพราะแผนที่แบบ raster เอียง (tilt) ได้เฉพาะ
// พื้นที่ที่ Google มีภาพถ่ายมุม 45° ซึ่งย่านรามคำแหงไม่มี จึงกดปุ่ม 3D แล้วไม่มีอะไรเกิดขึ้น
// DEMO_MAP_ID ใช้ทดสอบได้ทันที แต่ก่อน demo จริงควรสร้าง Map ID ของตัวเองใน Google Cloud Console
// (Google Maps Platform > Map management > Create map ID, Map type = JavaScript, Rendering = Vector)
// เพราะ Map ID ของตัวเองตั้งสไตล์/ซ่อน POI ที่ไม่เกี่ยวกับมหาลัยได้ ส่วน DEMO_MAP_ID ตั้งไม่ได้
const GOOGLE_MAPS_MAP_ID = '3b904d628ff6dcd13b559086';

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
  parkingZones: [],
  navigation: { path: [] }, // โหลดจาก /api/parking/zones — ใช้ทั้งทาสีเลเยอร์และหาลานจอดใกล้จุดหมาย
  map: {
    instance: null,
    is3DMode: false,
    // เปิดครบทุกเลเยอร์ไว้ก่อน ผู้ใช้ค่อยกดปิดที่ไม่สนใจทิ้งเอง
    activeLayers: new Set(['building', 'parking', 'other']),
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
  // pictureUrl: null → แสดง avatar ตัวอักษรแทนรูป (ทดสอบ fallback path ได้ทันที)
  window.liff = { getProfile: async () => ({ userId: 'DEV_USER', displayName: 'นักพัฒนา (Dev)', pictureUrl: null }) };
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

// getUserProfile — ดึง profile เต็ม (userId + displayName + pictureUrl) สำหรับแสดงผลใน LIFF UI เท่านั้น
// ไม่ส่งค่า displayName/pictureUrl ไป backend และไม่เก็บ localStorage (CONTEXT.md "PII")
// เรียกซ้ำได้ปลอดภัย — cache ไว้ใน memory ตลอด session
let cachedProfile = null;
async function getUserProfile() {
  if (cachedProfile) return cachedProfile;
  await liffBoot.promise;
  const raw = await liff.getProfile();
  cachedProfile = {
    userId: raw.userId,
    displayName: raw.displayName || null,
    pictureUrl: raw.pictureUrl || null,
  };
  // sync กับ cachedUserId เผื่อ getUserId() ยังไม่เคยถูกเรียก
  if (!cachedUserId) {
    cachedUserId = raw.userId;
    appState.user.lineUserId = cachedUserId;
  }
  return cachedProfile;
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

// แผนที่รวมทุกอย่างจาก data/ru_master.geojson (93 จุด) ไว้ในหน้าเดียว แล้วให้ผู้ใช้กรองเอาเองด้วย
// ชิปเลือกเลเยอร์ด้านบน — โหลดเป็นไฟล์ static จาก LIFF ตรงๆ ไม่ผ่าน KV เพราะเป็นข้อมูลนิ่งล้วนๆ
// (สถานะลานจอดที่เปลี่ยนตามเวลายังดึงจาก /api/parking/zones แล้วมาทาสีทับทีหลัง)
const MASTER_GEOJSON_URL = 'data/ru_master.geojson';

// "อื่นๆ" = ทุกอย่างที่ไม่ใช่อาคารและไม่ใช่ที่จอดรถ (ร้านค้า + จุดสังเกต) ตามที่ทีมกำหนด
// หมายเหตุ: category ในไฟล์ต้นทางสะกดว่า "orther" (พิมพ์ผิดตั้งแต่ต้นทาง) — ไม่แก้ไฟล์ต้นทาง
// เพื่อให้ sync กับของทีมได้ตรงๆ แต่รับค่าทั้งสองแบบไว้เผื่อวันหลังมีคนแก้
// ไอคอนเป็น SVG สีเดียว (ใช้ currentColor) ไม่ใช่อีโมจิ — อีโมจิสีสันเยอะและหน้าตาต่างกันไป
// ตามระบบปฏิบัติการ ทำให้แถบปุ่มดูไม่เป็นชุดเดียวกัน
const ICON_SVG = {
  building: '<path d="M3 21V5h8v4h10v12H3zm2-2h6V7H5v12zm8 0h6v-8h-6v8z"/>',
  parking: '<path d="M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11v7a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H8v1a1 1 0 01-1 1H6a1 1 0 01-1-1v-7zm2.2-1h9.6l-1-3H8.2l-1 3zM7.5 15a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z"/>',
  other: '<path d="M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">${ICON_SVG[name]}</svg>`;
}

const MAP_LAYERS = [
  { id: 'building', label: 'อาคาร', color: '#6c5ce7', categories: ['building'] },
  { id: 'parking', label: 'ที่จอดรถ', color: '#f0932b', categories: ['parking'] },
  { id: 'other', label: 'อื่นๆ', color: '#22a06b', categories: ['shop', 'orther', 'other'] },
];

const LAYER_STYLE = {
  building: { stroke: '#5b8def', fill: '#5b8def', fillOpacity: 0.25 },
  parking: { fillOpacity: 0.38 },
  shop: '#f39c12',
  landmark: '#9b59b6',
};

// กล้องเริ่มต้นกำหนดมาเป็น "ความสูงเหนือพื้น (เมตร)" + องศาก้มกล้อง แต่ Google Maps JS API
// ตั้งกล้องด้วย zoom ไม่ใช่ altitude จึงต้องแปลงก่อน ใช้สูตรเทียบมาตรฐานของ Google Earth
//   altitude = 35,200,000 / 2^zoom   =>   zoom = log2(35,200,000 / altitude)
// เป็นค่าประมาณ ไม่ได้คิดผลของละติจูด (ที่ 13.75° ต่างราว 3%) ถ้าอยากเป๊ะกว่านี้ต้องวัดจากจอจริง
// 2D เป็น raster ซึ่งรองรับเฉพาะ zoom จำนวนเต็ม ตั้ง 250 ม. ไปก็โดนปัดเป็น zoom 17 (=268 ม.)
// อยู่ดี จึงใส่ 268 ไปตรงๆ ให้ค่าที่เขียนไว้ตรงกับที่เห็นจริง (zoom 17 พอดี)
// 3D เป็น vector รองรับ zoom ทศนิยม 165 ม. -> zoom 17.70 ได้เป๊ะ
const ZOOM_REFERENCE_ALTITUDE_M = 35200000;

// ป้าย POI ของ Google ซ่อนได้จากโค้ดเฉพาะแผนที่แบบ raster (ห้ามมี mapId) เท่านั้น —
// ถ้ามี mapId Google จะไม่รับ styles และบังคับให้ไปตั้งในคอนโซลแทน แต่ style ในคอนโซล
// ก็ทำให้ตึก 3D หายทุกครั้งที่ลอง จึงแยกเป็นสองโหมดคนละชนิดแผนที่ไปเลย:
//   2D = raster ไม่มี mapId -> ใส่ styles ซ่อนป้ายได้จากในโค้ด แต่ไม่มีตึก 3D (ซึ่งโหมด 2D ไม่ต้องใช้)
//   3D = vector มี mapId (ต้องไม่ผูก style ในคอนโซล) -> ได้ตึก 3D แต่ป้าย Google จะโผล่มาด้วย
// mapId เปลี่ยนหลังสร้างแผนที่ไม่ได้ (ทดสอบแล้ว setOptions({mapId}) ถูกเพิกเฉย) การสลับโหมด
// จึงต้องสร้าง map instance ใหม่ทั้งก้อนแล้ววาดทุกอย่างกลับ ดู rebuildMap()
const MINIMAL_MAP_STYLES = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

const CAMERA_PRESETS = {
  '2d': { altitudeMeters: 268, tilt: 0, heading: 0, mapId: null },
  '3d': { altitudeMeters: 165, tilt: 60, heading: 20, mapId: GOOGLE_MAPS_MAP_ID },
};

function currentMode() {
  return appState.map.is3DMode ? '3d' : '2d';
}

function createMapInstance(center) {
  const preset = CAMERA_PRESETS[currentMode()];
  const options = {
    center,
    zoom: altitudeToZoom(preset.altitudeMeters),
    tilt: preset.tilt,
    heading: preset.heading,
    disableDefaultUI: true,
    zoomControl: false,
    clickableIcons: false,
  };
  // ใส่ได้อย่างใดอย่างหนึ่งเท่านั้น ใส่พร้อมกัน Google จะทิ้ง styles แล้วเตือนในคอนโซล
  if (preset.mapId) options.mapId = preset.mapId;
  else options.styles = MINIMAL_MAP_STYLES;

  const map = new google.maps.Map(document.getElementById('map'), options);
  appState.map.instance = map;
  RouteCalculator.init(map);
  map.addListener('center_changed', updateLayerToggleAvailability);
  map.addListener('zoom_changed', updateBuildingMarkerVisibility);
  return map;
}

function altitudeToZoom(altitudeMeters) {
  return Math.log2(ZOOM_REFERENCE_ALTITUDE_M / altitudeMeters);
}

// ป้ายชิปต้องเห็นตั้งแต่มุมมองเริ่มต้น เพราะตอนนี้อาคารแสดงเป็นป้ายอย่างเดียว ไม่มีรูปทรงให้เห็นแล้ว
// ถ้าตั้งเกณฑ์สูงกว่า zoom เริ่มต้น พอเปิดหน้ามาจะไม่เห็นอาคารเลยสักหลัง — ผูกกับ preset 2D ไว้
// จะได้ไม่เพี้ยนถ้าวันหลังมีคนแก้ความสูงกล้อง (เผื่อไว้ 0.5 ระดับสำหรับตอนผู้ใช้ซูมออกเอง)
const BUILDING_MARKER_MIN_ZOOM = altitudeToZoom(CAMERA_PRESETS['2d'].altitudeMeters) - 0.5;

let masterFeatures = null;
let targetPin = null;
let userPin = null;
const layerOverlays = { building: [], parking: [], other: [] };
const buildingMarkers = [];

function escapeXml(text) {
  return String(text).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

// ชื่ออาคารในไฟล์ต้นทางขึ้นต้นด้วยรหัสเสมอ แต่คั่นไม่เหมือนกัน — "KLB (อาคาร...)", "LWB: คณะ...",
// "ECB 2 (...)", "GB 4: ..." จึงดึงเฉพาะรหัสตัวหน้ามาทำป้ายชิป ถ้าไม่เข้ารูป (เช่น "ราม ไชยา,
// ซุ้มนักศึกษา") ก็ไม่ต้องมีชิป ปล่อยให้เห็นแค่รูปทรงอาคารพอ
function buildingCodeFromName(name) {
  const match = name.match(/^([A-Z]{2,4})\s?(\d)?\b/);
  if (!match) return null;
  return match[1] + (match[2] || '');
}

function polygonCentroid(points) {
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
  return { lat, lng };
}

// GeoJSON เก็บพิกัดเป็น [lng, lat] สลับกับที่ Google Maps ใช้ และปิดวงด้วยจุดซ้ำจุดแรก
// ซึ่ง google.maps.Polygon ปิดให้เองอยู่แล้ว
function toMapFeature(raw) {
  const props = raw.properties || {};
  const category = props.category;
  const name = (props.name || '').replace(/\s+/g, ' ').trim();
  const geometry = raw.geometry || {};
  if (!category || !name) return null;

  if (geometry.type === 'Polygon') {
    const ring = (geometry.coordinates[0] || []).map(([lng, lat]) => ({ lat, lng }));
    if (ring.length < 3) return null;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) ring.pop();
    return { category, name, polygon: ring, ...polygonCentroid(ring) };
  }
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates;
    return { category, name, polygon: null, lat, lng };
  }
  return null;
}

async function loadMasterFeatures() {
  if (masterFeatures) return masterFeatures;
  const res = await fetch(MASTER_GEOJSON_URL);
  if (!res.ok) throw new Error('โหลดข้อมูลแผนที่ไม่สำเร็จ');
  const geo = await res.json();
  masterFeatures = (geo.features || []).map(toMapFeature).filter(Boolean);
  return masterFeatures;
}

function isWithinCampusBounds({ lat, lng }) {
  const g = CAMPUS_CONSTANTS.GEOFENCE;
  return lat >= g.minLat && lat <= g.maxLat && lng >= g.minLng && lng <= g.maxLng;
}

async function renderMapView({ presetDestId, presetZoneId } = {}) {
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
      <div class="map-search">
        <svg class="map-search-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M10 4a6 6 0 104.24 10.24l4.26 4.26 1.5-1.5-4.26-4.26A6 6 0 0010 4zm0 2a4 4 0 110 8 4 4 0 010-8z"/>
        </svg>
        <input id="search-input" type="search" autocomplete="off" placeholder="ค้นหาอาคาร ลานจอด ร้านค้า" aria-label="ค้นหาสถานที่" />
        <button class="map-search-clear" id="search-clear" aria-label="ล้างคำค้น" hidden>&times;</button>
      </div>
      <ul class="search-results" id="search-results" hidden></ul>
      <div id="nav-instruction-slot"></div>
      <div class="map-controls">
        <div class="layer-row" id="layer-chips"></div>
        <button class="view-toggle-btn" id="layer-toggle-btn" aria-label="สลับมุมมอง 2 มิติ/3 มิติ">3D</button>
      </div>
      <div id="notice-bar-slot"></div>
      <div id="action-sheet-slot"></div>
    </div>
  `;
  document.getElementById('layer-toggle-btn').addEventListener('click', toggle3D);

  buildingMarkers.length = 0;
  targetPin = null;
  userPin = null;
  Object.keys(layerOverlays).forEach((k) => { layerOverlays[k] = []; });

  createMapInstance(CAMPUS_CONSTANTS.INITIAL_VIEW.center);
  SheetManager.setOnClose(clearTarget);
  appState.map.instance.addListener('zoom_changed', updateBuildingMarkerVisibility);
  updateLayerToggleAvailability();

  let features;
  try {
    features = await loadMasterFeatures();
  } catch (err) {
    console.error(err);
    renderError('โหลดข้อมูลแผนที่ไม่สำเร็จ กรุณาลองใหม่');
    return;
  }

  // สถานะลานจอดสดๆ มาแยกจาก geojson — จับคู่กับ polygon ด้วยชื่อโซน (ตรงกันทุกโซนอยู่แล้ว)
  await loadParkingZones();

  renderLayerChips();
  renderSearch(features);
  renderLayers();

  if (presetDestId) {
    const target = await resolvePresetBuilding(presetDestId, features);
    if (!target) {
      renderError('ไม่พบข้อมูลอาคารนี้ครับ กรุณาลองใหม่จากเมนูแชท');
      return;
    }
    await selectTarget(target);
  } else if (presetZoneId) {
    const zone = appState.parkingZones.find((z) => z.zone_id === presetZoneId);
    if (!zone) {
      renderError('ไม่พบข้อมูลลานจอดนี้ครับ กรุณาลองใหม่จากเมนูแชท');
      return;
    }
    await selectTarget({ id: zone.zone_id, name: zone.zone_name, type: 'PARKING', coords: { lat: zone.lat, lng: zone.lng } });
  } else {
    centerOnFeatures(features);
  }

  // Google ปัด zoom ที่ส่งเข้า constructor เป็นจำนวนเต็ม (15.83 -> 16) ความสูงกล้องเริ่มต้นเลย
  // เพี้ยนเป็น 537 ม. แทน 605 ม. ต้องสั่งทับเอง — แต่ระหว่างที่ยังโหลด tile อยู่ Google จะปัด
  // zoom ทศนิยมที่เราสั่งทิ้งทุกครั้ง (ลองทั้งตอน new Map(), หลัง idle รอบแรก และท้าย render
  // แล้วโดนปัดกลับเป็น 16 หมด) ต้องรอ 'tilesloaded' ถึงจะยึดค่าทศนิยมได้จริง
  // สั่งทันทีหนึ่งครั้งด้วยเผื่อ tile โหลดเสร็จไปก่อนแล้ว
  applyViewMode();
}

// deep link จาก Flex Message ส่งมาเป็น building_id ของฐานข้อมูลบอท (มี alias/ข้อมูลบริการผูกอยู่)
// ไม่ใช่ชื่อใน geojson จึงต้องถาม /api/building ก่อน แล้วค่อยหา polygon ที่ตรงรหัสมาไฮไลต์
async function resolvePresetBuilding(buildingId, features) {
  let data;
  try {
    data = await fetchJSON(`/api/building?building_id=${encodeURIComponent(buildingId)}`);
  } catch (err) {
    console.error('โหลดข้อมูลอาคารไม่สำเร็จ', err);
    return null;
  }
  const building = data.building;
  if (!building) return null;
  const match = features.find((f) => f.category === 'building' && buildingCodeFromName(f.name) === building.building_id);
  const coords = match ? { lat: match.lat, lng: match.lng } : { lat: building.lat, lng: building.lng };
  return { id: building.building_id, name: building.name_th, type: 'BUILDING', coords };
}

async function loadParkingZones() {
  try {
    const data = await fetchJSON('/api/parking/zones');
    appState.parkingZones = (data.zones || []).map(({ zone, parking_status: status }) => ({
      ...zone,
      status: (status && status.status) || zone.baseline_status,
    }));
  } catch (err) {
    console.error('โหลดข้อมูลลานจอดไม่สำเร็จ', err);
    appState.parkingZones = [];
  }
}

// --- Search (ค้นหาข้ามทุกหมวดในชุดข้อมูลเดียวกับที่วาดบนแผนที่) ---

const SEARCH_MAX_RESULTS = 8;
const CATEGORY_LABEL = { building: 'อาคาร', parking: 'ที่จอดรถ', shop: 'ร้านค้า', orther: 'สถานที่', other: 'สถานที่' };

// เลือกเป้าหมายจากผลค้นหาต้องใช้ type เดียวกับตอนแตะบนแผนที่ ไม่งั้น runContextRouting จะเลือก
// โหมดเดินทางผิด (ลานจอด = ขับรถ, ที่เหลือ = เดิน)
function featureToTarget(feature) {
  const code = feature.category === 'building' ? buildingCodeFromName(feature.name) : null;
  const type = feature.category === 'parking' ? 'PARKING' : feature.category === 'building' ? 'BUILDING' : 'PLACE';
  const zone = feature.category === 'parking' ? appState.parkingZones.find((z) => z.zone_name === feature.name) : null;
  return {
    id: zone ? zone.zone_id : code || feature.name,
    name: feature.name,
    type,
    coords: { lat: feature.lat, lng: feature.lng },
  };
}

function renderSearch(features) {
  const input = document.getElementById('search-input');
  const list = document.getElementById('search-results');
  const clearBtn = document.getElementById('search-clear');
  if (!input || !list) return;

  const closeResults = () => {
    list.hidden = true;
    list.innerHTML = '';
  };

  const run = () => {
    const query = input.value.trim().toLowerCase();
    clearBtn.hidden = !query;
    if (!query) return closeResults();

    const matches = features
      .filter((f) => f.name.toLowerCase().includes(query))
      .slice(0, SEARCH_MAX_RESULTS);

    if (!matches.length) {
      list.innerHTML = '<li class="search-empty">ไม่พบสถานที่ที่ค้นหา</li>';
      list.hidden = false;
      return;
    }

    list.innerHTML = matches.map((f, i) => `
      <li><button class="search-result" data-index="${i}">
        <span class="search-result-name">${escapeXml(f.name)}</span>
        <span class="search-result-category">${CATEGORY_LABEL[f.category] || f.category}</span>
      </button></li>`).join('');
    list.hidden = false;

    list.querySelectorAll('.search-result').forEach((btn) => {
      btn.addEventListener('click', () => {
        const feature = matches[Number(btn.dataset.index)];
        input.value = '';
        clearBtn.hidden = true;
        closeResults();
        input.blur();
        selectTarget(featureToTarget(feature));
      });
    });
  };

  input.addEventListener('input', run);
  input.addEventListener('focus', run);
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    closeResults();
    input.focus();
  });
}

// --- Layer chips (กดเลือกได้หลายอัน เลเยอร์ที่ไม่ได้เลือกจะถูกซ่อน) ---

function renderLayerChips() {
  const slot = document.getElementById('layer-chips');
  if (!slot) return;
  slot.innerHTML = MAP_LAYERS.map((layer) => {
    const on = appState.map.activeLayers.has(layer.id);
    return `<button class="layer-card${on ? ' active' : ''}" data-layer="${layer.id}"`
      + ` style="--card-color:${layer.color}" title="${layer.label}" aria-label="${layer.label}"`
      + ` aria-pressed="${on}">${icon(layer.id)}</button>`;
  }).join('');

  slot.querySelectorAll('.layer-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.layer;
      const active = appState.map.activeLayers;
      // กันปิดครบทุกเลเยอร์จนแผนที่ว่างเปล่าไม่เหลืออะไรให้กดต่อ
      if (active.has(id) && active.size === 1) return;
      if (active.has(id)) active.delete(id); else active.add(id);
      renderLayerChips();
      renderLayers();
    });
  });
}

function clearLayerOverlays() {
  Object.keys(layerOverlays).forEach((id) => {
    layerOverlays[id].forEach((o) => o.setMap(null));
    layerOverlays[id] = [];
  });
  buildingMarkers.length = 0;
}

function renderLayers() {
  const map = appState.map.instance;
  if (!map || !masterFeatures) return;
  clearLayerOverlays();

  MAP_LAYERS.forEach((layer) => {
    if (!appState.map.activeLayers.has(layer.id)) return;
    masterFeatures
      .filter((f) => layer.categories.includes(f.category))
      .forEach((feature) => addFeatureOverlay(layer.id, feature));
  });

  updateBuildingMarkerVisibility();
  highlightBuildingMarker(appState.target && appState.target.type === 'BUILDING' ? appState.target.id : null);
  nudgeMapRepaint(map);
}

function addFeatureOverlay(layerId, feature) {
  if (layerId === 'building') return addBuildingOverlay(feature);
  if (layerId === 'parking') return addParkingOverlay(feature);
  return addPointOverlay(feature);
}

// อาคารแสดงเป็น "ป้ายชิปรหัส" อย่างเดียว ไม่วาดรูปทรงพื้นที่ — พื้นที่ระบายสีสงวนไว้ให้ลานจอด
// อย่างเดียว จะได้แยกออกทันทีว่าสีบนแผนที่หมายถึงที่จอดรถเสมอ (polygon อาคารยังอยู่ในไฟล์ต้นทาง
// ถ้าวันหลังอยากวาดกลับมาก็ใช้ feature.polygon ได้เลย)
function addBuildingOverlay(feature) {
  const code = buildingCodeFromName(feature.name);
  if (!code) return;
  const target = { id: code, name: feature.name, type: 'BUILDING', coords: { lat: feature.lat, lng: feature.lng } };

  const marker = new google.maps.Marker({
    position: { lat: feature.lat, lng: feature.lng },
    map: appState.map.instance,
    title: feature.name,
    icon: buildingMarkerIcon(code, false),
  });
  marker.buildingId = code;
  marker.addListener('click', () => selectTarget(target));
  layerOverlays.building.push(marker);
  buildingMarkers.push(marker);
}

function addParkingOverlay(feature) {
  const map = appState.map.instance;
  const zone = appState.parkingZones.find((z) => z.zone_name === feature.name);
  const status = zone ? zone.status : null;
  const color = PARKING_STATUS_COLOR[status] || '#95a5a6';

  const shape = new google.maps.Polygon({
    map,
    paths: feature.polygon,
    strokeColor: color,
    strokeOpacity: 0.95,
    strokeWeight: 2,
    fillColor: color,
    fillOpacity: LAYER_STYLE.parking.fillOpacity,
    clickable: true,
  });
  shape.addListener('click', () => {
    selectTarget({
      id: zone ? zone.zone_id : feature.name,
      name: feature.name,
      type: 'PARKING',
      coords: { lat: feature.lat, lng: feature.lng },
    });
  });
  layerOverlays.parking.push(shape);
}

function addPointOverlay(feature) {
  const isShop = feature.category === 'shop';
  const marker = new google.maps.Marker({
    position: { lat: feature.lat, lng: feature.lng },
    map: appState.map.instance,
    title: feature.name,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 6,
      fillColor: isShop ? LAYER_STYLE.shop : LAYER_STYLE.landmark,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    },
  });
  marker.addListener('click', () => {
    selectTarget({ id: feature.name, name: feature.name, type: isShop ? 'SHOP' : 'PLACE', coords: { lat: feature.lat, lng: feature.lng } });
  });
  layerOverlays.other.push(marker);
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

// จัดกล้องให้เห็นทุกอย่างพอดีจอ — การขยับกล้องจริงยังจำเป็นเพื่อปลุกให้ vector map วาด overlay
// ที่เพิ่งเพิ่มเข้าไปด้วย (ดู nudgeMapRepaint)
function centerOnFeatures(features) {
  const map = appState.map.instance;
  if (!map || !features.length) return;
  const bounds = new google.maps.LatLngBounds();
  features.forEach((f) => bounds.extend({ lat: f.lat, lng: f.lng }));
  map.setCenter(bounds.getCenter());
  updateBuildingMarkerVisibility();
}

// --- Profile view (MVP-SPEC §7, docs/adr/0003) ---
// ?mode=profile → LINE profile header → consent gate (localStorage) → ฟอร์มบันทึกวิชาสอบ + ลิสต์/ลบ

// --- helper: คำนวณวันที่เหลือถึงสอบ ---
function daysUntilExam(isoString) {
  if (!isoString) return null;
  const exam = new Date(isoString);
  if (Number.isNaN(exam.getTime())) return null;
  return Math.ceil((exam - Date.now()) / (1000 * 60 * 60 * 24));
}

// --- helper: badge "เหลืออีก X วัน" ---
function renderDaysLeft(days) {
  if (days === null) return '';
  if (days < 0)  return '<span class="schedule-days-left past">สอบไปแล้ว</span>';
  if (days === 0) return '<span class="schedule-days-left urgent">วันนี้!</span>';
  if (days <= 3) return `<span class="schedule-days-left urgent">เหลืออีก ${days} วัน</span>`;
  if (days <= 7) return `<span class="schedule-days-left soon">เหลืออีก ${days} วัน</span>`;
  return `<span class="schedule-days-left normal">เหลืออีก ${days} วัน</span>`;
}

// --- สร้าง HTML ของ Profile header card ---
// profile = { userId, displayName, pictureUrl } | null
function renderProfileHeaderHTML(profile) {
  const name = (profile && profile.displayName) ? escapeXml(profile.displayName) : '—';

  // รูปโปรไฟล์: ถ้ามี pictureUrl ใช้ <img>, ไม่มีใช้ตัวอักษรแรกของชื่อ
  const firstChar = (profile && profile.displayName)
    ? escapeXml(profile.displayName.charAt(0).toUpperCase())
    : '?';
  const avatarHTML = (profile && profile.pictureUrl)
    ? `<img class="profile-avatar" src="${escapeXml(profile.pictureUrl)}" alt="รูปโปรไฟล์ LINE" />`
    : `<div class="profile-avatar-placeholder">${firstChar}</div>`;

  return `
    <div class="card profile-header">
      <div class="profile-avatar-ring">
        ${avatarHTML}
      </div>
      <h2 class="profile-name">${name}</h2>
    </div>
  `;
}

// renderProfileView — entry point สำหรับ ?mode=profile
// ตรวจสอบ consent ก่อน: ถ้ายังไม่เคยยินยอม แสดงหน้า consent gate ให้ติ๊กยินยอมก่อน
// ถ้าเคยยินยอมแล้ว แสดงหน้า Profile เต็มรูปแบบทันที
function renderProfileView() {
  const container = getApp();
  const hasConsent = localStorage.getItem(CONSENT_STORAGE_KEY) === 'true';

  if (hasConsent) {
    renderFullProfile(container);
  } else {
    renderConsentGate(container);
  }
}

// renderConsentGate — หน้าขอยืนยันความยินยอม (แสดงครั้งแรกก่อนเข้าหน้า Profile)
function renderConsentGate(container) {
  container.innerHTML = `
    <div class="card consent-card">
      <h2>ข้อตกลงและเงื่อนไขการใช้งาน <span class="badge-beta">Beta Test</span></h2>
      <p>ระบบรามรู้ทาง มีฟีเจอร์สำหรับบันทึกและจัดการข้อมูลการสอบ เพื่ออำนวยความสะดวกในการใช้งาน (ช่วงทดสอบระบบ Beta Test)</p>
      <p class="muted">
        • ระบบจะจัดเก็บข้อมูล <strong>รหัสวิชา</strong> เพื่อนำไปประมวลผลข้อมูลการสอบ<br>
        • ข้อมูลจะผูกกับบัญชี LINE ของคุณเท่านั้น ไม่มีการเก็บข้อมูลส่วนบุคคล เช่น ชื่อ-นามสกุล หรือเบอร์โทรศัพท์
      </p>
      <label class="consent-checkbox-label">
        <input type="checkbox" id="consent-check" />
        <span>ข้าพเจ้ารับทราบและยินยอมให้บันทึกข้อมูลดังกล่าว</span>
      </label>
      <button class="btn btn-primary" id="consent-accept-btn" disabled>ยืนยันและเข้าสู่ระบบ</button>
    </div>
  `;

  const checkEl = document.getElementById('consent-check');
  const btnEl = document.getElementById('consent-accept-btn');

  checkEl.addEventListener('change', () => {
    btnEl.disabled = !checkEl.checked;
  });

  btnEl.addEventListener('click', () => {
    if (!checkEl.checked) return;
    localStorage.setItem(CONSENT_STORAGE_KEY, 'true');
    renderFullProfile(container);
  });
}

// renderFullProfile — แสดงหน้าโปรไฟล์ (Header รูปโปรไฟล์/ชื่อ + ฟอร์มบันทึกและรายการวิชา)
async function renderFullProfile(container) {
  container.innerHTML = '<p style="text-align:center;padding:40px 0;color:var(--muted)">กำลังโหลด...</p>';

  // ดึง LINE profile สำหรับ header — fail silently ถ้า LIFF ใช้ไม่ได้
  let profile = null;
  try {
    profile = await getUserProfile();
  } catch (_) { /* แสดง header แบบไม่มีข้อมูล fallback */ }

  container.innerHTML = `
    ${renderProfileHeaderHTML(profile)}
    <div id="profile-schedule-slot"></div>
  `;

  const slot = document.getElementById('profile-schedule-slot');
  renderScheduleView(slot);
}

// --- Helper: Floating Toast Notification ---
let toastTimeout = null;
function showToast(message) {
  let toast = document.getElementById('profile-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'profile-toast';
    toast.className = 'profile-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

async function renderScheduleView(container) {
  container.innerHTML = '<p style="text-align:center;padding:20px 0;color:var(--muted)">กำลังโหลด...</p>';

  let userId;
  try {
    userId = await getUserId();
  } catch (err) {
    container.innerHTML = '<div class="card"><p class="muted">โหลดข้อมูลผู้ใช้ไม่สำเร็จ กรุณาเปิดใหม่จากแชท</p></div>';
    return;
  }

  renderScheduleForm(container, userId);
  await refreshScheduleList(userId);
}

function renderScheduleForm(container, userId) {
  container.innerHTML = `
    <div class="card schedule-section">
      <h2>บันทึกวิชาสอบ <span class="badge-beta">Beta Test</span></h2>
      <p class="muted" style="margin-bottom: 12px;">พิมพ์หรือวางรหัสวิชา (เพิ่มหลายวิชาคั่นด้วยจุลภาคหรือเว้นวรรคได้)</p>
      
      <form id="course-add-form">
        <div class="course-input-wrapper">
          <input
            type="text"
            id="course-input"
            class="course-input"
            placeholder="เช่น LAW1001 หรือ ENG1001, RAM1000"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="characters"
            required
          />
          <button type="submit" id="course-add-btn" class="course-add-btn">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>เพิ่ม</span>
          </button>
        </div>
      </form>

      <div class="quick-suggest-section">
        <span class="quick-suggest-title">วิชาพื้นฐานยอดนิยม:</span>
        <div class="quick-suggest-chips">
          <button type="button" class="chip-suggest" data-code="RAM1000">+ RAM1000</button>
          <button type="button" class="chip-suggest" data-code="ENG1001">+ ENG1001</button>
          <button type="button" class="chip-suggest" data-code="THA1003">+ THA1003</button>
          <button type="button" class="chip-suggest" data-code="HIS1003">+ HIS1003</button>
          <button type="button" class="chip-suggest" data-code="POL1100">+ POL1100</button>
          <button type="button" class="chip-suggest" data-code="LAW1001">+ LAW1001</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="schedule-header-row">
        <h2>วิชาที่ลงทะเบียนไว้</h2>
        <span id="course-count-badge" class="course-count-badge">0</span>
      </div>
      <div id="course-chips-container" class="course-chips-container">
        <div class="schedule-empty">กำลังโหลด...</div>
      </div>
    </div>
  `;

  const inputEl = document.getElementById('course-input');
  const addForm = document.getElementById('course-add-form');
  const addBtn = document.getElementById('course-add-btn');

  // ฟังก์ชันเพิ่มวิชา (รองรับทั้งพิมพ์เดี่ยว หลายวิชา หรือ Paste)
  async function addCourses(rawText) {
    if (!rawText) return;
    const codes = rawText
      .toUpperCase()
      .split(/[\s,;\n]+/)
      .map((c) => c.replace(/[^A-Z0-9]/g, ''))
      .filter((c) => c.length >= 3);

    if (codes.length === 0) {
      showToast('⚠️ กรุณาระบุรหัสวิชาให้ถูกต้อง');
      return;
    }

    addBtn.disabled = true;
    let addedCount = 0;

    for (const code of codes) {
      try {
        await fetchJSON('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            course_code: code,
          }),
        });
        addedCount++;
      } catch (err) {
        console.error('Error adding course', code, err);
      }
    }

    addBtn.disabled = false;
    inputEl.value = '';
    inputEl.focus(); // โฟกัสรอพิมพ์วิชาถัดไปต่อเนื่องทันที

    if (addedCount > 0) {
      showToast(codes.length === 1 ? `✓ เพิ่ม ${codes[0]} เรียบร้อย` : `✓ เพิ่มแล้ว ${addedCount} วิชา`);
      await refreshScheduleList(userId);
    } else {
      showToast('✕ ไม่สามารถบันทึกได้ กรุณาลองใหม่');
    }
  }

  // Submit form
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addCourses(inputEl.value);
  });

  // Quick suggestions click
  container.querySelectorAll('.chip-suggest').forEach((chip) => {
    chip.addEventListener('click', () => {
      addCourses(chip.dataset.code);
    });
  });
}

async function refreshScheduleList(userId) {
  const container = document.getElementById('course-chips-container');
  const badgeEl = document.getElementById('course-count-badge');
  if (!container) return;

  let data;
  try {
    data = await fetchJSON(`/api/schedule?user_id=${encodeURIComponent(userId)}`);
  } catch (err) {
    container.innerHTML = '<div class="schedule-empty">โหลดรายการไม่สำเร็จ</div>';
    return;
  }

  const schedules = data.schedules || [];
  if (badgeEl) badgeEl.textContent = schedules.length;

  if (schedules.length === 0) {
    container.innerHTML = '<div class="schedule-empty">ยังไม่มีวิชาที่ลงทะเบียนไว้</div>';
    return;
  }

  container.innerHTML = schedules
    .map(
      (s) => `
      <div class="course-chip" id="chip-${escapeXml(s.schedule_id)}">
        <span class="course-chip-code">${escapeXml(s.course_code)}</span>
        <button type="button" class="course-chip-del" data-id="${escapeXml(s.schedule_id)}" data-code="${escapeXml(s.course_code)}" aria-label="ลบ">&times;</button>
      </div>
    `
    )
    .join('');

  container.querySelectorAll('.course-chip-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const scheduleId = btn.dataset.id;
      const courseCode = btn.dataset.code;
      const chip = document.getElementById(`chip-${scheduleId}`);

      if (chip) chip.classList.add('is-deleting');

      try {
        await fetchJSON(
          `/api/schedule?user_id=${encodeURIComponent(userId)}&schedule_id=${encodeURIComponent(scheduleId)}`,
          { method: 'DELETE' }
        );
        showToast(`✕ ลบ ${courseCode} แล้ว`);
        await refreshScheduleList(userId);
      } catch (err) {
        if (chip) chip.classList.remove('is-deleting');
        showToast('ลบไม่สำเร็จ กรุณาลองใหม่');
      }
    });
  });
}

// ซูมออกไกลๆ ป้ายชิปจะทับกันเป็นพืด ซ่อนไปเลยดีกว่า เหลือแต่รูปทรงอาคาร
// getZoom() คืน undefined ได้ถ้าแผนที่ยังตั้งตัวไม่เสร็จ — default เป็น "โชว์" ไม่งั้นหมุดหายหมดเงียบๆ
function updateBuildingMarkerVisibility() {
  const map = appState.map.instance;
  if (!map) return;
  const zoom = map.getZoom();
  const visible = zoom === undefined || zoom >= BUILDING_MARKER_MIN_ZOOM;
  buildingMarkers.forEach((marker) => marker.setVisible(visible));
}

function highlightBuildingMarker(buildingId) {
  buildingMarkers.forEach((marker) => {
    const isSelected = marker.buildingId === buildingId;
    marker.setIcon(buildingMarkerIcon(marker.buildingId, isSelected));
    marker.setZIndex(isSelected ? 100 : 1);
  });
}

// Maps ล่ม (เน็ตสะดุด / key เกิน quota / referrer ไม่ผ่าน) — ยังต้องกดไปหน้าอื่นได้
// เพราะการรายงานลานจอดกับตารางสอบไม่ได้ใช้ Google Maps เลย
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
}

// เปิด 3D ได้เฉพาะตอนศูนย์กลางแผนที่อยู่ในรั้ว ม.รามฯ เท่านั้น (AC-05) — ใช้อาคาร 3D ของ Google เอง
// จาก vector map (ดู GOOGLE_MAPS_MAP_ID) ไม่ต้องดูแลข้อมูลรูปทรง/ความสูงตึกเองเลย
function toggle3D() {
  const btn = document.getElementById('layer-toggle-btn');
  if (!btn || btn.disabled || !appState.map.instance) return;
  setViewMode(!appState.map.is3DMode);
}

function setViewMode(is3D) {
  if (appState.map.is3DMode === is3D) return;
  appState.map.is3DMode = is3D;
  const btn = document.getElementById('layer-toggle-btn');
  if (btn) btn.textContent = is3D ? '2D' : '3D';
  rebuildMap();
}

// สลับโหมดต้องสร้าง map instance ใหม่ (mapId เปลี่ยนทีหลังไม่ได้) overlay ทุกตัวผูกกับแผนที่เดิม
// ทั้งหมดจึงต้องทิ้งแล้ววาดใหม่ — ถ้ามีจุดหมายค้างอยู่ก็เลือกซ้ำให้ เพื่อให้เส้นทาง/หมุด/การ์ดกลับมา
// เหมือนก่อนกดสลับ ผู้ใช้จะเห็นแค่แผนที่กระพริบแวบเดียว
function rebuildMap() {
  NavigationController.stop();
  const previous = appState.map.instance;
  const center = previous.getCenter();
  const target = appState.target;

  buildingMarkers.length = 0;
  Object.keys(layerOverlays).forEach((k) => { layerOverlays[k] = []; });
  targetPin = null;
  userPin = null;
  SheetManager.hide();

  createMapInstance({ lat: center.lat(), lng: center.lng() });
  renderLayers();
  if (appState.user.location) updateUserPin(appState.user.location);
  if (target) selectTarget(target);
  applyViewMode();
}

// Google ปัด zoom ทศนิยมทิ้งระหว่างที่ยังโหลด tile อยู่ ต้องรอ tilesloaded ถึงจะยึดค่าได้จริง
function applyViewMode() {
  const map = appState.map.instance;
  const preset = CAMERA_PRESETS[currentMode()];
  const apply = () => {
    map.setZoom(altitudeToZoom(preset.altitudeMeters));
    map.setTilt(preset.tilt);
    map.setHeading(preset.heading);
    nudgeMapRepaint(map);
  };
  apply();
  google.maps.event.addListenerOnce(map, 'tilesloaded', apply);
}

// vector map ของ Google ไม่วาดเฟรมใหม่ให้เอง หลังเปลี่ยนสถานะกล้องด้วยโค้ด (setTilt/setHeading/
// setZoom) หรือเพิ่งเพิ่ม overlay เข้าไป — จอจะค้างภาพเดิมหรือว่างเปล่าจนกว่าผู้ใช้จะไปแตะแผนที่เอง
// ขยับ 1 พิกเซลเพื่อบังคับให้วาดใหม่ (ตาเปล่ามองไม่เห็น) ลองแล้วทั้ง trigger 'resize' และ
// panBy(0,0) ไม่ได้ผล ต้องเป็นการขยับที่ระยะไม่ใช่ 0 เท่านั้น
function nudgeMapRepaint(map) {
  if (map) map.panBy(1, 0);
}

function updateLayerToggleAvailability() {
  const btn = document.getElementById('layer-toggle-btn');
  if (!btn || !appState.map.instance) return;
  const center = appState.map.instance.getCenter();
  const allowed = isWithinCampusBounds({ lat: center.lat(), lng: center.lng() });
  btn.disabled = !allowed;
  // ออกนอกรั้วแล้วบังคับกลับ 2D — setViewMode เช็คเองว่าโหมดเปลี่ยนจริงไหม ไม่งั้น listener
  // center_changed ที่ยิงตอน rebuild จะวนสร้างแผนที่ซ้ำไม่รู้จบ
  if (!allowed && appState.map.is3DMode) setViewMode(false);
}

// --- หมุดจุดหมาย + หมุดตำแหน่งผู้ใช้ ---

// วาดหมุดเป็น SVG เองทั้งคู่ เพราะหมุดมาตรฐานของ Google เป็นสีแดงสด ชนกับสีพื้นที่ลานจอด
// (แดง = เต็ม) จนสับสนว่าอันไหนคือจุดหมาย
// viewBox คงที่ 32x42 แต่ย่อขนาดที่วาดจริงลงเหลือ 24x32 — หมุดใหญ่เกินไปบังตัวแผนที่กับป้ายชิป
// รอบๆ จนดูรก โดยเฉพาะตอนซูมใกล้ที่หมุดกินพื้นที่ตึกทั้งหลัง
const PIN_WIDTH = 24;
const PIN_HEIGHT = 32;

function pinIcon(fill, glyph) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_WIDTH}" height="${PIN_HEIGHT}" viewBox="0 0 32 42">`
    + `<path d="M16 0C7.2 0 0 7.2 0 16c0 11.2 16 26 16 26s16-14.8 16-26c0-8.8-7.2-16-16-16z" fill="${fill}"/>`
    + `<g transform="translate(16 16)" fill="#ffffff">${glyph}</g></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(PIN_WIDTH, PIN_HEIGHT),
    anchor: new google.maps.Point(PIN_WIDTH / 2, PIN_HEIGHT),
  };
}

const TARGET_GLYPH = '<circle r="6"/>';

// ตำแหน่งผู้ใช้ใช้จุดกลมแบบเดียวกับ "ตำแหน่งของฉัน" ที่คนคุ้นจาก Google Maps/แอปนำทางทั่วไป
// ไม่ใช่หมุดหยดน้ำ — หมุดหยดน้ำสื่อว่า "จุดหมายอยู่ตรงนี้" ซึ่งควรเหลือไว้ให้ปลายทางอย่างเดียว
// จะได้ไม่มีหมุดหน้าตาเหมือนกันสองอันบนเส้นทางเดียว และจุดกลมกินพื้นที่น้อยกว่ามาก
const USER_DOT_SIZE = 26;

function userDotIcon() {
  const r = USER_DOT_SIZE / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${USER_DOT_SIZE}" height="${USER_DOT_SIZE}" viewBox="0 0 ${USER_DOT_SIZE} ${USER_DOT_SIZE}">`
    + `<circle cx="${r}" cy="${r}" r="${r}" fill="#1560ff" opacity="0.16"/>`
    + `<circle cx="${r}" cy="${r}" r="7" fill="#ffffff"/>`
    + `<circle cx="${r}" cy="${r}" r="5" fill="#1560ff"/></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(USER_DOT_SIZE, USER_DOT_SIZE),
    anchor: new google.maps.Point(r, r),
  };
}

function updateTargetPin(target) {
  const map = appState.map.instance;
  if (!map) return;
  if (targetPin) targetPin.setMap(null);
  targetPin = new google.maps.Marker({
    position: target.coords,
    map,
    title: target.name,
    icon: pinIcon('#1c1c1e', TARGET_GLYPH),
    zIndex: 999,
  });
}

function clearTargetPin() {
  if (targetPin) targetPin.setMap(null);
  targetPin = null;
}

// หมุดคนที่ตำแหน่งผู้ใช้ — วาดเองแทนจุดฟ้าของ Google เพราะจุดฟ้าจะขึ้นเฉพาะตอนได้สิทธิ์ GPS จริง
// ส่วนเคส fallback (ไม่ให้สิทธิ์ แล้วคำนวณจากประตูหน้า) ต้องเห็นด้วยว่าเส้นทางเริ่มจากตรงไหน
function updateUserPin(location) {
  const map = appState.map.instance;
  if (!map || !location) return;
  if (userPin) userPin.setMap(null);
  userPin = new google.maps.Marker({
    position: location,
    map,
    title: 'ตำแหน่งของคุณ',
    icon: userDotIcon(),
    zIndex: 998,
  });
}

// ผู้ใช้แตะเลือกอาคาร/ลานจอด/ร้านค้าจากแผนที่ (หรือถูกเลือกให้อัตโนมัติจาก dest_id/zone_id) —
// จุดเริ่มต้นของ Context Routing Matrix (§3) ทั้งหมด
async function selectTarget(target) {
  appState.target = target;
  SheetManager.hide();
  highlightBuildingMarker(target.type === 'BUILDING' ? target.id : null);
  updateTargetPin(target);
  appState.map.instance.panTo(target.coords);

  if (appState.user.isGpsAllowed && appState.user.location) {
    appState.user.isInsideCampus = isWithinCampusBounds(appState.user.location);
    updateUserPin(appState.user.location);
    await runContextRouting(target, appState.user.location);
    return;
  }

  try {
    const userLocation = await getUserLocation();
    appState.user.location = userLocation;
    appState.user.isGpsAllowed = true;
    SheetManager.hideGpsWarning();
    appState.user.isInsideCampus = isWithinCampusBounds(userLocation);
    updateUserPin(userLocation);
    await runContextRouting(target, userLocation);
  } catch (err) {
    appState.user.isGpsAllowed = false;
    handleGpsDenied(target);
  }
}

// อยู่นอกแคมปัส: ไม่ส่งไปจุดนัดพบกลางแล้ว แต่ส่งไป "ลานจอดที่ใกล้จุดหมายที่สุด" — คนขับรถมาสอบ
// ที่ ECB ต้องการรู้ว่าจอดตรงไหนถึงเดินเข้าใกล้ห้องสอบที่สุด ไม่ใช่ให้ไปกองรวมกันที่ประตูหน้า
function nearestParkingZone(coords) {
  let best = null;
  let bestDistance = Infinity;
  appState.parkingZones.forEach((zone) => {
    const distance = haversineDistanceMeters(coords.lat, coords.lng, zone.lat, zone.lng);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = zone;
    }
  });
  return best;
}

function googleDirectionsUrl({ lat, lng }) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

// ยกเลิกจุดหมาย — กลับไปสถานะที่ยังไม่ได้เลือกอะไร (ปุ่มกากบาทบนการ์ด)
function clearTarget() {
  NavigationController.stop();
  appState.target = null;
  SheetManager.hide();
  RouteCalculator.clearRoute();
  clearTargetPin();
  highlightBuildingMarker(null);
  nudgeMapRepaint(appState.map.instance);
}

// ชื่อในชุดข้อมูลยาวมากเพราะรวมทุกอย่างไว้ในบรรทัดเดียว เช่น
//   "OPB: สำนักงานอธิการบดี (Office of the President), AAB: อาคารสำนักบริการทางวิชาการ (...)"
// เอามาขึ้นหัวการ์ดตรงๆ แล้วรกตา ตัดเหลือเฉพาะชื่อไทยหลัก — ตัดรหัสอาคารนำหน้า (มีในป้ายชิป
// บนแผนที่อยู่แล้ว) ตัดวงเล็บภาษาอังกฤษท้ายชื่อ และตัดชื่อตัวที่สองหลังคอมม่าออก
// เก็บชื่อเต็มไว้ใน target.name เหมือนเดิม ใช้ตอนค้นหา/tooltip จะได้ยังเจอด้วยรหัสหรือชื่ออังกฤษ
function shortPlaceName(name) {
  let short = splitOutsideParens(name)[0].trim();
  short = short.replace(/^[A-Z][A-Z0-9\s,().]*:\s*/, '');       // "LWB 2: ...", "DS (DS 1, DS 2): ..."
  short = short.replace(/^[A-Z]{2,4}\s?\d?\s*(?=\()/, '');       // "LIB (สำนักหอสมุดกลาง)"
  short = short.replace(/^\((.+)\)$/, '$1');                    // เหลือแต่วงเล็บครอบทั้งชื่อ -> ถอดออก
  short = short.replace(/\s*\(([^()]*)\)\s*$/, (full, inner) => (/[A-Za-z]/.test(inner) && !/[\u0E00-\u0E7F]/.test(inner) ? '' : full));
  return short.trim() || name;
}

// แยกที่คอมม่าเฉพาะตัวที่อยู่นอกวงเล็บ ไม่งั้น "DS (DS 1, DS 2): ..." จะโดนตัดกลางวงเล็บ
function splitOutsideParens(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function formatDistance(meters) {
  return `${Math.round(meters)} m`;
}

// --- โหมดนำทาง ---

// ตามตำแหน่งจริงด้วย watchPosition — แต่บน localhost (DEV_MODE) จำลองการเดินไปตามเส้นทางแทน
// ไม่งั้นเทสไม่ได้เลยเพราะนั่งอยู่หน้าคอม ไม่ได้เดินอยู่ในแคมปัสจริง
const NAV_SIMULATION_INTERVAL_MS = 700;
const NAV_SIMULATION_STEP_METERS = 18;

function watchUserPosition(onUpdate) {
  if (DEV_MODE) return simulateWalk(onUpdate);
  const watchId = navigator.geolocation.watchPosition(
    (pos) => onUpdate({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    (err) => console.error('watchPosition error', err),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );
  return () => navigator.geolocation.clearWatch(watchId);
}

// เดินไล่ไปตามเส้น path ของเส้นทางจริงทีละ ~18 ม. ให้เหมือนคนเดินความเร็วปกติ
function simulateWalk(onUpdate) {
  const path = appState.navigation.path;
  if (!path || path.length < 2) return () => {};
  let index = 0;
  let progress = 0;
  const timer = setInterval(() => {
    if (index >= path.length - 1) return;
    const from = path[index];
    const to = path[index + 1];
    const segment = haversineDistanceMeters(from.lat, from.lng, to.lat, to.lng);
    progress += NAV_SIMULATION_STEP_METERS;
    while (progress >= segment && index < path.length - 1) {
      progress -= segment;
      index += 1;
      if (index >= path.length - 1) break;
    }
    const a = path[Math.min(index, path.length - 1)];
    const b = path[Math.min(index + 1, path.length - 1)];
    const segLen = haversineDistanceMeters(a.lat, a.lng, b.lat, b.lng) || 1;
    const t = Math.min(1, progress / segLen);
    onUpdate({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  }, NAV_SIMULATION_INTERVAL_MS);
  return () => clearInterval(timer);
}

function startNavigation(target, route) {
  if (!route.steps || !route.steps.length) return;
  appState.navigation.path = route.path || [];

  NavigationController.start({
    steps: route.steps,
    path: route.path,
    totalMeters: route.distanceMeters,
    destinationName: shortPlaceName(target.name),
    watch: watchUserPosition,
    onPosition: (location) => {
      appState.user.location = location;
      updateUserPin(location);
      appState.map.instance.panTo(location);
      const status = NavigationController.status();
      if (status && !status.arrived) {
        SheetManager.updateNavigationStats(formatDistance(status.remainingMeters), `${status.remainingMinutes} นาที`);
      }
    },
    onArrive: () => {
      SheetManager.updateNavigationStats('ถึงแล้ว', '-');
    },
    // เดินหลงออกนอกเส้นทาง — คำนวณใหม่จากตำแหน่งปัจจุบันไปจุดหมายเดิม แล้วยัดเส้นใหม่เข้า session
    // ที่กำลังทำงานอยู่ ไม่ต้องเริ่มโหมดนำทางใหม่ (watch จะได้ไม่ขาดช่วง)
    onOffRoute: async (location) => {
      try {
        const travelMode = target.type === 'PARKING' ? 'DRIVING' : 'WALKING';
        const fresh = await RouteCalculator.calculateRoute(location, target.coords, travelMode);
        appState.navigation.path = fresh.path || [];
        NavigationController.updateRoute(fresh);
        SheetManager.updateNavigationStats(formatDistance(fresh.distanceMeters), `${fresh.durationMinutes} นาที`);
      } catch (err) {
        console.error('คำนวณเส้นทางใหม่ไม่สำเร็จ', err);
      }
    },
    onStop: () => {
      appState.navigation.path = [];
      // กลับไปการ์ดปกติให้กดเริ่มเดินทางใหม่ได้ ถ้ายังเลือกจุดหมายเดิมค้างอยู่
      if (appState.target) selectTarget(appState.target);
    },
  });

  SheetManager.showNavigationSheet({
    title: shortPlaceName(target.name),
    remainingText: formatDistance(route.distanceMeters),
    etaText: `${route.durationMinutes} นาที`,
    onStop: () => NavigationController.stop(),
  });
}

// Context Routing Matrix (Module_2_Technical_Specification.md §3)
async function runContextRouting(target, originLocation, opts) {
  if (!appState.user.isInsideCampus) {
    const zone = nearestParkingZone(target.coords);
    const destination = zone ? { lat: zone.lat, lng: zone.lng } : CAMPUS_CONSTANTS.DEFAULT_ORIGIN;
    if (zone) appState.map.instance.panTo(destination);
    SheetManager.showOffCampusSheet({
      title: shortPlaceName(target.name),
      parkingName: zone ? zone.zone_name : null,
      parkingStatus: zone ? PARKING_STATUS_LABEL[zone.status] || null : null,
      onOpenGoogleMaps: () => window.open(googleDirectionsUrl(destination), '_blank'),
    });
    return;
  }

  const travelMode = target.type === 'PARKING' ? 'DRIVING' : 'WALKING';
  try {
    const route = await RouteCalculator.calculateRoute(originLocation, target.coords, travelMode);
    const originNote = opts && opts.isFallbackOrigin ? ' (ประมาณจากประตูหน้า)' : '';
    SheetManager.showRouteSheet({
      title: shortPlaceName(target.name),
      distanceText: formatDistance(route.distanceMeters),
      durationText: `${route.durationMinutes} นาที${originNote}`,
      actionLabel: 'เริ่มเดินทาง',
      onAction: () => startNavigation(target, route),
    });
  } catch (err) {
    console.error('คำนวณเส้นทางไม่สำเร็จ', err);
    RouteCalculator.clearRoute();
    SheetManager.showRouteErrorSheet({
      title: shortPlaceName(target.name),
      onFocus: () => appState.map.instance.panTo(target.coords),
    });
  }
}

// GPS Denied Fallback (§3 แถว Fallback, AC-04) — พฤติกรรมเดิมไม่เปลี่ยน: โชว์แถบเตือนพร้อมกับแผนที่
// (ไม่ใช่แทนที่กัน) แล้วคำนวณเส้นทางจาก DEFAULT_ORIGIN ให้อัตโนมัติ ไม่ crash
function handleGpsDenied(target) {
  SheetManager.showGpsWarning(() => selectTarget(target));
  appState.user.isInsideCampus = true;
  updateUserPin(CAMPUS_CONSTANTS.DEFAULT_ORIGIN);
  runContextRouting(target, CAMPUS_CONSTANTS.DEFAULT_ORIGIN, { isFallbackOrigin: true });
}


// โหลด Google Maps JS API script แบบ dynamic (ไม่ผูกไว้ตรงๆ ใน index.html) เพื่อให้ GOOGLE_MAPS_API_KEY
// มี source of truth เดียวอยู่ในไฟล์นี้ — เรียก initApp() (นิยามไว้ด้านบน) เป็น callback เมื่อโหลดเสร็จ
(function loadGoogleMaps() {
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&callback=initApp&libraries=geometry`;
  script.async = true;
  script.onerror = () => mapsBoot.reject(new Error('โหลดสคริปต์ Google Maps ไม่สำเร็จ'));
  document.head.appendChild(script);
})();

// เริ่มที่ท้ายไฟล์ เพราะ main() อ่านค่าคงที่/สถานะที่ประกาศไว้ด้านบนทั้งหมด — และเริ่มได้ทันที
// ไม่ต้องรอ dependency ภายนอกตัวไหนแล้ว (แต่ละ view รอเองตามที่ตัวเองต้องใช้)
main();
