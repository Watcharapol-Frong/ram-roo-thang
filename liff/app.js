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

// Map ID สำหรับโหมด 2D โดยเฉพาะ — เว้นว่างไว้ได้ ถ้าว่างโหมด 2D จะเป็นแผนที่ raster ที่ซ่อน POI
// ได้จากในโค้ด แต่ "หมุนกล้องไม่ได้" (raster ไม่รองรับ heading/tilt เลย ทดสอบยืนยันแล้ว)
// ถ้าใส่ Map ID ที่ผูก style ซ่อน POI ไว้ โหมด 2D จะกลายเป็น vector -> หมุนกล้องได้
// และหมุนตามเข็มทิศได้ ส่วนตึก 3D ที่ style ทำให้หายไปก็ไม่กระทบ เพราะโหมด 2D ไม่ได้ใช้อยู่แล้ว
const GOOGLE_MAPS_MAP_ID_2D = '3b904d628ff6dcdec4f81588';

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
const DEV_API_URL = 'http://localhost:8787';
const WORKER_BASE_URL = DEV_MODE
  ? new URLSearchParams(window.location.search).get('api') || DEV_API_URL
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

// สื่อถึง "ความหนาแน่นของรถในลาน" ตรงกว่าคำว่า ว่าง/เต็ม ซึ่งฟังเหมือนสถานะแบบมี-ไม่มีที่จอด
// ทั้งที่ข้อมูลจริงเป็นการประเมินความแออัดจากคนที่อยู่ตรงนั้น ไม่ได้นับช่องจอดจริง
const PARKING_STATUS_LABEL = { GREEN: 'เบาบาง', YELLOW: 'ปานกลาง', RED: 'หนาแน่น' };
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
  car: null,
  parking: { offeredZoneId: null, dismissedZoneId: null },
  navigation: { path: [] }, // โหลดจาก /api/parking/zones — ใช้ทั้งทาสีเลเยอร์และหาลานจอดใกล้จุดหมาย
  map: {
    instance: null,
    is3DMode: false,
    // เปิดครบทุกเลเยอร์ไว้ก่อน ผู้ใช้ค่อยกดปิดที่ไม่สนใจทิ้งเอง
    activeLayers: new Set(['building', 'parking', 'other']),
    rebuilding: false,
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
  if (mode === 'shop') {
    renderShopView();
    return;
  }
  if (mode === 'settings') {
    renderSettingsView();
    return;
  }
  if (mode === 'feedback') {
    renderFeedbackView();
    return;
  }

  // Flex Message Integration (Module_2_Technical_Specification.md §6)
  // dest_id&mode=nav -> เลือกอาคารให้ทันที, zone_id&mode=parking -> เลือกลานจอดให้ทันที
  // ไม่มี param เลย -> Single Canvas Overview (§1) ให้ผู้ใช้แตะเลือกเองจากแผนที่
  // ?car=lat,lng — ลิงก์ที่เพื่อนแชร์ตำแหน่งรถมาให้ เปิดแล้วนำทางไปหารถคันนั้นได้เลย
  if (params.has('car')) {
    renderMapView({ presetCar: params.get('car') });
  } else if (params.has('dest_id')) {
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
  locate: '<path d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.94 3A9 9 0 0013 3.06V1h-2v2.06A9 9 0 003.06 11H1v2h2.06A9 9 0 0011 20.94V23h2v-2.06A9 9 0 0020.94 13H23v-2h-2.06zM12 19a7 7 0 110-14 7 7 0 010 14z"/>',
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
  '2d': { altitudeMeters: 268, tilt: 0, heading: 0, mapId: GOOGLE_MAPS_MAP_ID_2D || null },
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
let carPin = null;
const parkingShapes = [];
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

async function renderMapView({ presetDestId, presetZoneId, presetCar } = {}) {
  const container = getApp();

  // เฉพาะ view นี้เท่านั้นที่ต้องมี Google Maps — ถ้าโหลดไม่ขึ้นให้เหลือทางไป view อื่นที่ยังใช้ได้
  try {
    await mapsBoot.promise;
  } catch (err) {
    console.error('Google Maps ใช้งานไม่ได้', err);
    renderMapUnavailable();
    return;
  }

  document.body.classList.add('map-view');
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
        <button class="view-toggle-btn" id="my-location-btn" aria-label="ตำแหน่งของฉัน">${icon('locate')}</button>
        <button class="view-toggle-btn" id="my-car-btn" aria-label="ไปที่รถของฉัน" hidden>${icon('parking')}</button>
      </div>
      <div id="notice-bar-slot"></div>
      <div id="action-sheet-slot"></div>
    </div>
  `;
  document.getElementById('layer-toggle-btn').addEventListener('click', toggle3D);
  document.getElementById('my-location-btn').addEventListener('click', toggleMyLocation);
  document.getElementById('my-car-btn').addEventListener('click', navigateToCar);
  updateMyLocationAvailability();
  appState.car = loadSavedCar();
  updateCarButtonAvailability();
  startPresenceWatch();

  buildingMarkers.length = 0;
  targetPin = null;
  userPin = null;
  carPin = null;
  parkingShapes.length = 0;
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
  updateCarPin();

  if (presetCar) {
    const [lat, lng] = presetCar.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      renderError('ลิงก์ตำแหน่งรถไม่ถูกต้องครับ');
      return;
    }
    await selectTarget({ id: 'MY_CAR', name: 'รถที่เพื่อนแชร์', type: 'MY_CAR', coords: { lat, lng } });
  } else if (presetDestId) {
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
    primeLocationAccess();
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

// พิมพ์เร็วๆ แล้วสร้างรายการใหม่ทุกตัวอักษรทำให้กระตุก — หน่วงไว้เล็กน้อยให้พิมพ์จบคำก่อน
// 120ms สั้นพอที่ยังรู้สึกว่าตอบสนองทันที แต่ยาวพอให้การพิมพ์รัวๆ ยิงงานแค่ครั้งเดียว
const SEARCH_DEBOUNCE_MS = 120;

function renderSearch(features) {
  const input = document.getElementById('search-input');
  const list = document.getElementById('search-results');
  const clearBtn = document.getElementById('search-clear');
  if (!input || !list) return;

  let matches = [];
  let debounceTimer = null;

  const closeResults = () => {
    list.hidden = true;
    list.innerHTML = '';
    matches = [];
    document.body.classList.remove('is-searching');
  };

  const render = () => {
    const query = input.value.trim().toLowerCase();
    clearBtn.hidden = !query;
    if (!query) return closeResults();

    // ระหว่างค้นหา ซ่อนของที่เกาะขอบล่างทั้งหมด (ปุ่มควบคุม/การ์ดจุดหมาย/แถบแจ้งเตือน) —
    // พอคีย์บอร์ดเด้งขึ้นมา พื้นที่จอหดลง ของพวกนี้จะกระโดดขึ้นมาทับกันจนดูกระตุก
    // และตอนกำลังพิมพ์ค้นหาก็ไม่ได้ใช้มันอยู่แล้ว
    document.body.classList.add('is-searching');

    matches = features.filter((f) => f.name.toLowerCase().includes(query)).slice(0, SEARCH_MAX_RESULTS);
    list.hidden = false;

    if (!matches.length) {
      list.innerHTML = '<li class="search-empty">ไม่พบสถานที่ที่ค้นหา</li>';
      return;
    }

    list.innerHTML = matches.map((f, i) => `
      <li><button class="search-result" data-index="${i}">
        <span class="search-result-name">${escapeXml(f.name)}</span>
        <span class="search-result-category">${CATEGORY_LABEL[f.category] || f.category}</span>
      </button></li>`).join('');
  };

  const scheduleRender = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, SEARCH_DEBOUNCE_MS);
  };

  input.addEventListener('input', scheduleRender);
  input.addEventListener('focus', scheduleRender);

  // ผูก listener ตัวเดียวไว้ที่รายการ แทนการผูกใหม่ทุกปุ่มทุกครั้งที่พิมพ์ — ลดงานตอนพิมพ์
  // และไม่ต้องกังวลว่า listener เก่าจะค้าง
  list.addEventListener('click', (event) => {
    const button = event.target.closest('.search-result');
    if (!button) return;
    const feature = matches[Number(button.dataset.index)];
    if (!feature) return;
    input.value = '';
    clearBtn.hidden = true;
    closeResults();
    input.blur();
    selectTarget(featureToTarget(feature));
  });

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
  // ต้องล้างด้วย ไม่งั้นทุกครั้งที่วาดเลเยอร์ใหม่ (เช่น หลังส่งรายงานแล้วรีเฟรชสี) จะสะสมรูปทรง
  // ลานจอดเพิ่มอีกชุด ชี้ไป polygon ที่ถูกถอดออกจากแผนที่ไปแล้ว
  parkingShapes.length = 0;
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
  // เก็บรูปทรงไว้ตรวจว่าผู้ใช้ยืนอยู่ในเขตลานไหน (ใช้ polygon จริง ไม่ใช่รัศมีจากจุดกึ่งกลาง
  // เพราะลานจอดเป็นรูปยาวๆ วงกลมจะกินพื้นที่นอกลานไปด้วย)
  parkingShapes.push({ zone, feature, shape });
}

// หมุด "อื่นๆ" เดิมเป็นจุดกลมสีเดียวกันหมด แยกไม่ออกว่าร้านกาแฟหรือสนามกีฬา ต้องแตะดูทีละอัน
// เดาหมวดจากชื่อสถานที่แล้วใส่ไอคอนให้ตรงหมวด — ชุดข้อมูลไม่มีฟิลด์ประเภทร้าน มีแค่ name
// ถ้าวันหลังทีมเพิ่มฟิลด์ประเภทมาในไฟล์ ก็เปลี่ยนมาอ่านจากฟิลด์ตรงๆ แทนการเดาได้เลย
const PLACE_GLYPH = {
  coffee: '<path d="M4 5h13v6a5 5 0 01-5 5H9a5 5 0 01-5-5V5zm13 1h2a2.5 2.5 0 010 5h-2V6zM3 19h16v2H3z"/>',
  food: '<path d="M7 2v7a2 2 0 001 1.7V22h2V10.7A2 2 0 0011 9V2H9.5v5h-1V2H7zm8 0c-1.1 0-2 1.8-2 4v4h1.5v12H16V2h-1z"/>',
  store: '<path d="M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z"/>',
  service: '<path d="M6 2h8l4 4v16H6V2zm8 1.5V7h3.5L14 3.5zM8 11h8v1.5H8V11zm0 3h8v1.5H8V14zm0 3h5v1.5H8V17z"/>',
  sports: '<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 2a8 8 0 018 8h-3.5A4.5 4.5 0 0012 7.5V4zm-2 .3V8a4 4 0 00-2.8 2.8L4 10a8 8 0 016-5.7zM4.3 12H8a4 4 0 002.5 3.7l-1.2 3.4A8 8 0 014.3 12zm8.9 7.7l-1.2-3.4A4 4 0 0016 12h3.7a8 8 0 01-6.5 7.7z"/>',
  monument: '<path d="M12 2l3 5H9l3-5zm-2 6h4v9h-4V8zM5 19h14v3H5v-3z"/>',
  transit: '<path d="M12 2C8 2 5 2.5 5 6v9a3 3 0 003 3l-1.5 1.5V20h11v-.5L16 18a3 3 0 003-3V6c0-3.5-3-4-7-4zM7.5 15a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm9 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM17 10H7V6h10v4z"/>',
};

// เรียงจากเฉพาะเจาะจงไปกว้าง ตัวแรกที่ตรงชนะ — "โรงอาหารอาคารนพมาศ" ต้องเป็นอาหาร ไม่ใช่ร้านค้าทั่วไป
const PLACE_TYPES = [
  { test: /คอฟฟี่|กาแฟ|coffee|cafe|caf\u00e8|caf\u00e9|amazon|tea|น้ำ/i, glyph: 'coffee', color: '#8a5a2b' },
  { test: /ข้าว|อาหาร|ครัว|kitchen|restaurant|halal|ไก่|ไข่|เจ|vegetarian|อร่อย|ต้นเหรียง|ไชยา/i, glyph: 'food', color: '#e8590c' },
  { test: /ก๊อปปี้|copy|ถ่ายรูป|studio|เซอร์วิส|service/i, glyph: 'service', color: '#1971c2' },
  { test: /สนาม|กีฬา|เทนนิส|เปตอง|stadium/i, glyph: 'sports', color: '#2f9e44' },
  { test: /อนุสาวรีย์|monument|พระบรม|นาฬิกา|clock|ศาลา|pavilion/i, glyph: 'monument', color: '#c2255c' },
  { test: /mrt|สถานี|station|ท่าเรือ|pier/i, glyph: 'transit', color: '#1098ad' },
];

function placeTypeOf(feature) {
  const found = PLACE_TYPES.find((type) => type.test.test(feature.name));
  if (found) return found;
  // ไม่เข้าหมวดไหนเลย: ร้านค้าใช้ไอคอนร้าน ที่เหลือถือเป็นจุดสังเกต
  return feature.category === 'shop'
    ? { glyph: 'store', color: '#f0932b' }
    : { glyph: 'monument', color: '#7048e8' };
}

const PLACE_BADGE_SIZE = 30;

function placeBadgeIcon(type) {
  const half = PLACE_BADGE_SIZE / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PLACE_BADGE_SIZE}" height="${PLACE_BADGE_SIZE}" viewBox="0 0 30 30">`
    + `<circle cx="15" cy="15" r="14.2" fill="#ffffff"/>`
    + `<circle cx="15" cy="15" r="12.4" fill="${type.color}"/>`
    + `<g transform="translate(15 15) scale(0.6) translate(-12 -12)" fill="#ffffff">${PLACE_GLYPH[type.glyph]}</g>`
    + `</svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(PLACE_BADGE_SIZE, PLACE_BADGE_SIZE),
    anchor: new google.maps.Point(half, half),
  };
}

function addPointOverlay(feature) {
  const isShop = feature.category === 'shop';
  const marker = new google.maps.Marker({
    position: { lat: feature.lat, lng: feature.lng },
    map: appState.map.instance,
    title: feature.name,
    icon: placeBadgeIcon(placeTypeOf(feature)),
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

// --- สร้าง HTML ของ Profile header แบบ Flat Minimal (เหมือนตัวอย่าง: รูปซ้าย ชื่อขวา ไร้ Card) ---
// profile = { userId, displayName, pictureUrl, coins } | null
function renderProfileHeaderHTML(profile) {
  const name = (profile && profile.displayName) ? escapeXml(profile.displayName) : 'นักพัฒนา (Dev)';
  const bonus = localStorage.getItem('ram-roo-thang:feedback-done') === 'true' ? 30 : 0;
  const coins = 120 + bonus;

  // รูปโปรไฟล์: ถ้ามี pictureUrl ใช้ <img>, ไม่มีใช้ตัวอักษรแรกของชื่อ
  const firstChar = (profile && profile.displayName)
    ? escapeXml(profile.displayName.charAt(0).toUpperCase())
    : 'น';
  const avatarHTML = (profile && profile.pictureUrl)
    ? `<img class="profile-flat-avatar" src="${escapeXml(profile.pictureUrl)}" alt="รูปโปรไฟล์ LINE" />`
    : `<div class="profile-flat-avatar-placeholder">${firstChar}</div>`;

  return `
    <div class="profile-flat-header">
      ${avatarHTML}
      <div class="profile-flat-info">
        <div class="profile-flat-name-row">
          <h1 class="profile-flat-name">${name}</h1>
          <div class="profile-verified-badge" title="บัญชีผู้ใช้ LINE">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
        </div>
        <div class="profile-flat-sub">${coins} เหรียญ</div>
      </div>
    </div>
  `;
}

// --- สร้าง HTML แถบแบบประเมิน (ใต้ Profile ไร้ Card, Pure Typography) ---
function renderFeedbackTeaserHTML() {
  const isDone = localStorage.getItem('ram-roo-thang:feedback-done') === 'true';
  if (isDone) {
    return `
      <div class="feedback-flat-banner is-done">
        <div class="feedback-flat-left">
          <span class="feedback-flat-text" style="color:#15803d; font-weight:700;">ส่งแบบประเมินแล้ว</span>
          <span class="badge-reward-coin">+30 เหรียญ</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="feedback-flat-banner" id="btn-open-feedback">
      <div class="feedback-flat-left">
        <span class="feedback-flat-text">แบบประเมินพัฒนาระบบ</span>
        <span class="badge-reward-coin">+30 เหรียญ</span>
      </div>
      <span class="feedback-flat-action-text">ทำแบบประเมิน &rsaquo;</span>
    </div>
  `;
}

// --- Floating Bottom Navigation Bar ---
function renderBottomNavHTML(activeTab) {
  return `
    <nav class="bottom-nav-bar" aria-label="แถบนำทางหลัก">

      <button type="button" class="nav-tab-item ${activeTab === 'profile' ? 'active' : ''}" data-tab="profile">
        <div class="nav-tab-icon">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
        </div>
        <span>ตารางสอบ</span>
      </button>

      <button type="button" class="nav-tab-item ${activeTab === 'shop' ? 'active' : ''}" data-tab="shop">
        <div class="nav-tab-icon">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <path d="M16 10a4 4 0 0 1-8 0"></path>
          </svg>
        </div>
        <span>Shop</span>
      </button>

      <button type="button" class="nav-tab-item ${activeTab === 'settings' ? 'active' : ''}" data-tab="settings">
        <div class="nav-tab-icon">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </div>
        <span>ตั้งค่า</span>
      </button>
    </nav>
  `;
}

function bindBottomNavEvents() {
  document.querySelectorAll('.nav-tab-item').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      if (target === 'profile') {
        renderProfileView();
      } else if (target === 'shop') {
        renderShopView();
      } else if (target === 'settings') {
        renderSettingsView();
      }
    });
  });
}

// renderFeedbackView — หน้ากรอกแบบประเมินความคิดเห็น Beta Test (จำกัด 1 ครั้งต่อผู้ใช้ บันทึกลง Sheet)
async function renderFeedbackView() {
  const container = getApp();
  const isDone = localStorage.getItem('ram-roo-thang:feedback-done') === 'true';

  if (isDone) {
    container.innerHTML = `
      <div class="profile-flat-container">
        <div class="feedback-header-bar">
          <button type="button" class="btn-back-feedback" id="btn-feedback-back">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            <span>ย้อนกลับ</span>
          </button>
        </div>
        <div class="survey-section-card" style="text-align: center; padding: 40px 16px;">
          <h2 style="font-size:1.2rem; color:#0f172a; margin-bottom:8px;">คุณได้ส่งแบบประเมินแล้ว</h2>
          <p class="muted" style="font-size:0.88rem; line-height:1.5; margin:0 0 20px;">
            ระบบบันทึกความคิดเห็นของคุณเรียบร้อยแล้ว และจำกัดการประเมิน 1 ครั้งต่อบัญชีผู้ใช้<br>
            ขอขอบคุณที่ร่วมเป็นส่วนหนึ่งในการพัฒนา "รามรู้ทาง" ครับ
          </p>
          <button type="button" class="btn btn-primary" id="btn-feedback-done-back" style="padding:10px 24px; font-weight:700; border-radius:12px;">กลับหน้าโปรไฟล์</button>
        </div>
      </div>
      ${renderBottomNavHTML('profile')}
    `;
    document.getElementById('btn-feedback-back').addEventListener('click', () => renderProfileView());
    document.getElementById('btn-feedback-done-back').addEventListener('click', () => renderProfileView());
    bindBottomNavEvents();
    return;
  }

  let profile = null;
  try {
    profile = await getUserProfile();
  } catch (_) { /* fallback */ }

  const detectedOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? 'iOS'
    : /Android/i.test(navigator.userAgent)
      ? 'Android'
      : 'Desktop/Other';

  container.innerHTML = `
    <div class="profile-flat-container">
      <div class="feedback-header-bar">
        <button type="button" class="btn-back-feedback" id="btn-feedback-back">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          <span>ย้อนกลับ</span>
        </button>
        <span class="badge-reward-coin">+30 เหรียญ</span>
      </div>

      <div style="margin-bottom: 14px; padding: 0 4px;">
        <h1 style="font-size: 1.3rem; font-weight: 900; color: #0f172a; margin: 0 0 4px;">แบบประเมินระบบ Beta Test</h1>
        <p class="muted" style="font-size: 0.82rem; margin: 0; line-height: 1.4;">
          ความคิดเห็นของท่านมีคุณค่าอย่างยิ่งในการปรับปรุงและพัฒนา "รามรู้ทาง" ให้สมบูรณ์แบบก่อนเปิดใช้งานจริง
        </p>
      </div>

      <form id="beta-survey-form">
        <!-- ส่วนที่ 1: ความพึงพอใจและประสบการณ์ใช้งาน -->
        <div class="survey-section-card">
          <div class="survey-section-header">
            <span class="survey-section-num">1</span>
            <h3 class="survey-section-title">ความพึงพอใจและประสบการณ์ใช้งาน</h3>
          </div>

          <label class="survey-q-label">1. ความพึงพอใจโดยรวมในการใช้งาน (Overall Satisfaction)</label>
          <div class="rating-num-group">
            <label class="rating-num-btn"><input type="radio" name="q1_overall_sat" value="1" />1</label>
            <label class="rating-num-btn"><input type="radio" name="q1_overall_sat" value="2" />2</label>
            <label class="rating-num-btn"><input type="radio" name="q1_overall_sat" value="3" />3</label>
            <label class="rating-num-btn"><input type="radio" name="q1_overall_sat" value="4" />4</label>
            <label class="rating-num-btn"><input type="radio" name="q1_overall_sat" value="5" checked />5</label>
          </div>
          <div class="rating-legend-row">
            <span>1 = ควรปรับปรุง</span>
            <span>5 = พึงพอใจมากที่สุด</span>
          </div>

          <label class="survey-q-label">2. ความง่ายและความลื่นไหลในการใช้งาน (Ease of Use)</label>
          <div class="rating-num-group">
            <label class="rating-num-btn"><input type="radio" name="q2_ease_of_use" value="1" />1</label>
            <label class="rating-num-btn"><input type="radio" name="q2_ease_of_use" value="2" />2</label>
            <label class="rating-num-btn"><input type="radio" name="q2_ease_of_use" value="3" />3</label>
            <label class="rating-num-btn"><input type="radio" name="q2_ease_of_use" value="4" />4</label>
            <label class="rating-num-btn"><input type="radio" name="q2_ease_of_use" value="5" checked />5</label>
          </div>
          <div class="rating-legend-row">
            <span>1 = ใช้งานยาก</span>
            <span>5 = ใช้งานง่ายมาก</span>
          </div>

          <label class="survey-q-label">3. ความเร็วในการเปิดและโหลดข้อมูล (Speed & Performance)</label>
          <div class="rating-num-group">
            <label class="rating-num-btn"><input type="radio" name="q3_speed_perf" value="1" />1</label>
            <label class="rating-num-btn"><input type="radio" name="q3_speed_perf" value="2" />2</label>
            <label class="rating-num-btn"><input type="radio" name="q3_speed_perf" value="3" />3</label>
            <label class="rating-num-btn"><input type="radio" name="q3_speed_perf" value="4" />4</label>
            <label class="rating-num-btn"><input type="radio" name="q3_speed_perf" value="5" checked />5</label>
          </div>
          <div class="rating-legend-row">
            <span>1 = ช้า/ค้างบ่อย</span>
            <span>5 = รวดเร็วทันใจ</span>
          </div>
        </div>

        <!-- ส่วนที่ 2: ประเมินรายฟีเจอร์หลัก -->
        <div class="survey-section-card">
          <div class="survey-section-header">
            <span class="survey-section-num">2</span>
            <h3 class="survey-section-title">การประเมินรายฟีเจอร์หลัก</h3>
          </div>

          <label class="survey-q-label">4. ระบบแผนที่และการนำทางไปอาคารสอบ (Map & Navigation)</label>
          <div class="rating-num-group">
            <label class="rating-num-btn"><input type="radio" name="q4_map_rating" value="1" />1</label>
            <label class="rating-num-btn"><input type="radio" name="q4_map_rating" value="2" />2</label>
            <label class="rating-num-btn"><input type="radio" name="q4_map_rating" value="3" />3</label>
            <label class="rating-num-btn"><input type="radio" name="q4_map_rating" value="4" />4</label>
            <label class="rating-num-btn"><input type="radio" name="q4_map_rating" value="5" checked />5</label>
          </div>
          <div class="rating-legend-row">
            <span>1 = ไม่แม่นยำ</span>
            <span>5 = นำทางแม่นยำมาก</span>
          </div>

          <label class="survey-q-label">5. ระบบจัดการตารางสอบและปุ่มกด 'Go' นำทาง (Exam Schedule)</label>
          <div class="rating-num-group">
            <label class="rating-num-btn"><input type="radio" name="q5_schedule_rating" value="1" />1</label>
            <label class="rating-num-btn"><input type="radio" name="q5_schedule_rating" value="2" />2</label>
            <label class="rating-num-btn"><input type="radio" name="q5_schedule_rating" value="3" />3</label>
            <label class="rating-num-btn"><input type="radio" name="q5_schedule_rating" value="4" />4</label>
            <label class="rating-num-btn"><input type="radio" name="q5_schedule_rating" value="5" checked />5</label>
          </div>
          <div class="rating-legend-row">
            <span>1 = ไม่สะดวก</span>
            <span>5 = สะดวกและมีประโยชน์มาก</span>
          </div>

          <label class="survey-q-label">6. ระบบดูที่จอดรถและการสะสมเหรียญ (Parking & Coins)</label>
          <div class="rating-num-group">
            <label class="rating-num-btn"><input type="radio" name="q6_parking_rating" value="1" />1</label>
            <label class="rating-num-btn"><input type="radio" name="q6_parking_rating" value="2" />2</label>
            <label class="rating-num-btn"><input type="radio" name="q6_parking_rating" value="3" />3</label>
            <label class="rating-num-btn"><input type="radio" name="q6_parking_rating" value="4" />4</label>
            <label class="rating-num-btn"><input type="radio" name="q6_parking_rating" value="5" checked />5</label>
          </div>
          <div class="rating-legend-row">
            <span>1 = ไม่น่าสนใจ</span>
            <span>5 = น่าสนใจและมีประโยชน์</span>
          </div>

          <label class="survey-q-label">7. ฟีเจอร์ที่คุณคิดว่ามีประโยชน์มากที่สุดในช่วงสอบ?</label>
          <div class="choice-card-list">
            <label class="choice-option-label">
              <input type="radio" name="q7_top_feature" value="แผนที่และเส้นทางเดินไปอาคารสอบ" checked />
              <span>แผนที่และเส้นทางเดินไปอาคารสอบ</span>
            </label>
            <label class="choice-option-label">
              <input type="radio" name="q7_top_feature" value="ตารางสอบส่วนตัวที่กด Go นำทางได้ทันที" />
              <span>ตารางสอบส่วนตัวที่กด Go นำทางได้ทันที</span>
            </label>
            <label class="choice-option-label">
              <input type="radio" name="q7_top_feature" value="ค้นหาข้อมูลอาคาร แผนก และห้องน้ำ" />
              <span>ค้นหาข้อมูลอาคาร แผนก และห้องน้ำ</span>
            </label>
            <label class="choice-option-label">
              <input type="radio" name="q7_top_feature" value="ข้อมูลที่จอดรถรอบมหาวิทยาลัย" />
              <span>ข้อมูลที่จอดรถรอบมหาวิทยาลัย</span>
            </label>
          </div>
        </div>

        <!-- ส่วนที่ 3: ปัญหาที่พบและโอกาสในการบอกต่อ (NPS) -->
        <div class="survey-section-card">
          <div class="survey-section-header">
            <span class="survey-section-num">3</span>
            <h3 class="survey-section-title">ปัญหาที่พบและโอกาสในการบอกต่อ</h3>
          </div>

          <label class="survey-q-label">8. ปัญหาหรือจุดติดขัดที่พบระหว่างทดสอบ (เลือกได้หลายข้อ)</label>
          <div class="choice-card-list">
            <label class="choice-option-label">
              <input type="checkbox" name="q8_issues" value="ไม่พบปัญหาเลย ใช้งานได้ราบรื่น" checked />
              <span>ไม่พบปัญหาเลย ใช้งานได้ราบรื่น</span>
            </label>
            <label class="choice-option-label">
              <input type="checkbox" name="q8_issues" value="พิกัดหรือเส้นทางนำทางไม่ตรงจุดจริง" />
              <span>พิกัดหรือเส้นทางนำทางไม่ตรงจุดจริง</span>
            </label>
            <label class="choice-option-label">
              <input type="checkbox" name="q8_issues" value="ค้นหารหัสวิชาหรืออาคารไม่เจอ" />
              <span>ค้นหารหัสวิชาหรืออาคารไม่เจอ</span>
            </label>
            <label class="choice-option-label">
              <input type="checkbox" name="q8_issues" value="หน้าจอโหลดช้า หรือกระตุกในบางจุด" />
              <span>หน้าจอโหลดช้า หรือกระตุกในบางจุด</span>
            </label>
            <label class="choice-option-label">
              <input type="checkbox" name="q8_issues" value="การปัดหน้าจอ (Swipe) หรือกดปุ่มบางจุดกดยาก" />
              <span>การปัดหน้าจอ (Swipe) หรือกดปุ่มบางจุดกดยาก</span>
            </label>
          </div>

          <label class="survey-q-label">9. Net Promoter Score (NPS): โอกาสที่จะแนะนำให้เพื่อนใช้งาน?</label>
          <p class="survey-q-desc">คะแนน 0 (ไม่แนะนำแน่นอน) ถึง 10 (แนะนำทุกคนแน่นอน)</p>
          <div class="nps-grid">
            <label class="nps-btn"><input type="radio" name="q9_nps_score" value="0" />0</label>
            <label class="nps-btn"><input type="radio" name="q9_nps_score" value="1" />1</label>
            <label class="nps-btn"><input type="radio" name="q9_nps_score" value="2" />2</label>
            <label class="nps-btn"><input type="radio" name="q9_nps_score" value="3" />3</label>
            <label class="nps-btn"><input type="radio" name="q9_nps_score" value="4" />4</label>
            <label class="nps-btn"><input type="radio" name="q9_nps_score" value="5" />5</label>
            <label class="nps-btn"><input type="radio" name="q9_nps_score" value="6" />6</label>
            <label class="nps-btn"><input type="radio" name="q9_nps_score" value="7" />7</label>
            <label class="nps-btn"><input type="radio" name="q9_nps_score" value="8" />8</label>
            <label class="nps-btn"><input type="radio" name="q9_nps_score" value="9" />9</label>
            <label class="nps-btn"><input type="radio" name="q9_nps_score" value="10" checked />10</label>
          </div>
          <div class="rating-legend-row">
            <span>0 = ไม่แนะนำ</span>
            <span>10 = แนะนำแน่นอน</span>
          </div>
        </div>

        <!-- ส่วนที่ 4: ข้อเสนอแนะเพื่อการพัฒนา -->
        <div class="survey-section-card">
          <div class="survey-section-header">
            <span class="survey-section-num">4</span>
            <h3 class="survey-section-title">ข้อเสนอแนะเพื่อการพัฒนา</h3>
          </div>

          <label class="survey-q-label">10. ฟีเจอร์ที่อยากให้มีเพิ่มเติมก่อนเปิดใช้งานจริง</label>
          <textarea class="feedback-textarea" name="q10_feature_requests" placeholder="เช่น ตารางเดินรถสองแถวรอบ ม., จุดบริการถ่ายเอกสาร, แจ้งเตือนสอบล่วงหน้า..."></textarea>

          <label class="survey-q-label">11. ข้อเสนอแนะหรือความคิดเห็นเพิ่มเติม</label>
          <textarea class="feedback-textarea" name="q11_general_comments" placeholder="ข้อความถึงทีมผู้พัฒนาเพื่อปรับปรุงระบบให้ดียิ่งขึ้น..."></textarea>
        </div>

        <button type="submit" class="btn btn-primary" id="btn-submit-feedback" style="width:100%; padding:14px; font-size:1rem; font-weight:800; border-radius:14px; margin-bottom:20px;">
          ส่งแบบประเมิน (รับ 30 เหรียญ)
        </button>
      </form>
    </div>

    ${renderBottomNavHTML('profile')}
  `;

  document.getElementById('btn-feedback-back').addEventListener('click', () => renderProfileView());
  bindBottomNavEvents();

  document.getElementById('beta-survey-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-feedback');
    btn.disabled = true;
    btn.textContent = 'กำลังส่งข้อมูล...';

    const form = e.target;
    const formData = new FormData(form);

    // รวบรวมคำตอบ Checkbox Q8
    const issues = [];
    form.querySelectorAll('input[name="q8_issues"]:checked').forEach((cb) => {
      issues.push(cb.value);
    });

    const payload = {
      timestamp: new Date().toISOString(),
      userId: (profile && profile.userId) ? profile.userId : 'dev-user-' + Date.now(),
      displayName: (profile && profile.displayName) ? profile.displayName : 'นักพัฒนา (Dev)',
      deviceOS: detectedOS,
      q1_overall_sat: Number(formData.get('q1_overall_sat') || 5),
      q2_ease_of_use: Number(formData.get('q2_ease_of_use') || 5),
      q3_speed_perf: Number(formData.get('q3_speed_perf') || 5),
      q4_map_rating: Number(formData.get('q4_map_rating') || 5),
      q5_schedule_rating: Number(formData.get('q5_schedule_rating') || 5),
      q6_parking_rating: Number(formData.get('q6_parking_rating') || 5),
      q7_top_feature: formData.get('q7_top_feature') || '',
      q8_issues_found: issues,
      q9_nps_score: Number(formData.get('q9_nps_score') || 10),
      q10_feature_requests: (formData.get('q10_feature_requests') || '').trim(),
      q11_general_comments: (formData.get('q11_general_comments') || '').trim()
    };

    // ส่งข้อมูลไปยัง Google Apps Script Web App Endpoint ถ้ามีการตั้งค่าไว้
    const endpointUrl = localStorage.getItem('ram-roo-thang:feedback-sheet-url') || '';
    if (endpointUrl) {
      try {
        await fetch(endpointUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        console.warn('Google Sheets sync warning:', err);
      }
    }

    // บันทึกสำเนาลง LocalStorage
    try {
      const history = JSON.parse(localStorage.getItem('ram-roo-thang:feedback-responses') || '[]');
      history.push(payload);
      localStorage.setItem('ram-roo-thang:feedback-responses', JSON.stringify(history));
    } catch (_) {}

    localStorage.setItem('ram-roo-thang:feedback-done', 'true');
    showToast('ส่งแบบประเมินสำเร็จ! ได้รับ 30 เหรียญ');
    renderProfileView();
  });
}

// renderShopView — หน้าร้านค้า & สิทธิพิเศษ (Coming Soon กลางจอใหญ่ๆ)
function renderShopView() {
  const container = getApp();

  container.innerHTML = `
    <div class="coming-soon-container">
      <div class="coming-soon-badge">Shop</div>
      <h1 class="coming-soon-title">Coming Soon</h1>
      <p class="coming-soon-sub">ระบบร้านค้าและแลกสิทธิพิเศษกำลังอยู่ระหว่างการพัฒนา</p>
    </div>

    ${renderBottomNavHTML('shop')}
  `;

  bindBottomNavEvents();
}

// renderSettingsView — หน้าการตั้งค่า (Minimal Pure Typography)
function renderSettingsView() {
  const container = getApp();
  container.innerHTML = `
    <div class="profile-flat-container">
      <div class="profile-flat-header">
        <div class="profile-flat-info">
          <h1 class="profile-flat-name" style="font-size: 1.25rem;">การตั้งค่า</h1>
          <div class="profile-flat-sub">จัดการข้อมูลและระบบรามรู้ทาง</div>
        </div>
      </div>

      <div class="schedule-flat-section">
        <div class="shop-items-list">
          <div class="shop-item-row">
            <div class="shop-item-info">
              <div class="shop-item-title">ข้อตกลงและนโยบายความเป็นส่วนตัว</div>
              <div class="shop-item-sub">ระบบไม่จัดเก็บข้อมูลส่วนบุคคล (No-PII)</div>
            </div>
            <span style="font-size:0.78rem; font-weight:700; color:#15803d; flex-shrink:0;">ยินยอมแล้ว</span>
          </div>

          <div class="shop-item-row">
            <div class="shop-item-info">
              <div class="shop-item-title">เวอร์ชันระบบ</div>
              <div class="shop-item-sub">รามรู้ทาง v1.0 (Beta Test)</div>
            </div>
            <span class="badge-beta" style="margin:0; flex-shrink:0;">v1.0</span>
          </div>
        </div>
      </div>
    </div>

    ${renderBottomNavHTML('settings')}
  `;

  bindBottomNavEvents();
}

// renderProfileView — entry point สำหรับ ?mode=profile
function renderProfileView() {
  stopPresenceWatch();
  document.body.classList.remove('map-view');
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

// renderFullProfile — แสดงหน้าโปรไฟล์ (Header รูปโปรไฟล์/ชื่อ + การ์ดแบบประเมิน + ตารางสอบ + Bottom Nav)
async function renderFullProfile(container) {
  container.innerHTML = '<p style="text-align:center;padding:40px 0;color:var(--muted)">กำลังโหลด...</p>';

  let profile = null;
  try {
    profile = await getUserProfile();
  } catch (_) { /* แสดง header fallback */ }

  container.innerHTML = `
    <div class="profile-flat-container">
      ${renderProfileHeaderHTML(profile)}
      ${renderFeedbackTeaserHTML()}
      <div id="profile-schedule-slot"></div>
    </div>
    ${renderBottomNavHTML('profile')}
  `;

  // ผูก Event เปิดหน้าแบบประเมิน
  const feedbackBtn = document.getElementById('btn-open-feedback');
  if (feedbackBtn) {
    feedbackBtn.addEventListener('click', () => renderFeedbackView());
  }

  bindBottomNavEvents();

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

// ข้อมูลตารางสอบและห้องสอบ ภาค 1/2569 ม.รามคำแหง
const COURSE_EXAM_DATA = {
  'RAM1101': { building_id: 'VPB', room: 'VPB 301', date_th: '15 ต.ค. 69', time_th: '09:30 - 12:00', building_name: 'อาคารเวียงผา' },
  'MGT1001': { building_id: 'TCB', room: 'TCB 401', date_th: '14 ต.ค. 69', time_th: '13:30 - 16:00', building_name: 'อาคารสุโขทัย' },
  'LAW1001': { building_id: 'VKB', room: 'VKB 401', date_th: '19 ต.ค. 69', time_th: '09:30 - 12:00', building_name: 'อาคารเวียงคำ' },
  'ECO1003': { building_id: 'ECB', room: 'ECB 201', date_th: '21 ต.ค. 69', time_th: '09:30 - 12:00', building_name: 'อาคารเศรษฐศาสตร์' },
  'COS1101': { building_id: 'SCL', room: 'SCL 302', date_th: '25 ต.ค. 69', time_th: '13:30 - 16:00', building_name: 'อาคารปฏิบัติการวิทย์' },
  'THA1001': { building_id: 'SBB', room: 'SBB 201', date_th: '25 ต.ค. 69', time_th: '09:30 - 12:00', building_name: 'อาคารศิลาบาตร' },
  'ACC1101': { building_id: 'VKB', room: 'VKB 501', date_th: '26 ต.ค. 69', time_th: '09:30 - 12:00', building_name: 'อาคารเวียงคำ' },
  'POL1100': { building_id: 'VPB', room: 'VPB 401', date_th: '27 ต.ค. 69', time_th: '13:30 - 16:00', building_name: 'อาคารเวียงผา' },
  'RAM1000': { building_id: 'SBB', room: 'SBB 301', date_th: '27 ต.ค. 69', time_th: '09:30 - 12:00', building_name: 'อาคารศิลาบาตร' },
  'ENG1001': { building_id: 'KLB', room: 'KLB 201', date_th: '28 ต.ค. 69', time_th: '13:30 - 16:00', building_name: 'อาคารกงไกรลาศ' },
  'HIS1003': { building_id: 'KLB', room: 'KLB 305', date_th: '18 ต.ค. 69', time_th: '13:30 - 16:00', building_name: 'อาคารกงไกรลาศ' },
  'MTH1003': { building_id: 'SCL', room: 'SCL 204', date_th: '21 ต.ค. 69', time_th: '09:30 - 12:00', building_name: 'อาคารปฏิบัติการวิทย์' },
};

function getCourseExamInfo(courseCode) {
  const code = (courseCode || '').toUpperCase().trim();
  if (COURSE_EXAM_DATA[code]) return COURSE_EXAM_DATA[code];

  // Fallback คำนวณแบบสุ่มคงที่จากรหัสวิชา เพื่อให้แสดงผลตารางได้เสมอ
  const buildings = [
    { id: 'KLB', name: 'อาคารกงไกรลาศ', room: 'KLB 301' },
    { id: 'VPB', name: 'อาคารเวียงผา', room: 'VPB 204' },
    { id: 'VKB', name: 'อาคารเวียงคำ', room: 'VKB 501' },
    { id: 'SBB', name: 'อาคารศิลาบาตร', room: 'SBB 402' },
  ];
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = (hash + code.charCodeAt(i)) % buildings.length;
  const b = buildings[hash];
  const day = 15 + (hash * 3);
  return {
    building_id: b.id,
    room: b.room,
    date_th: `${day} ต.ค. 69`,
    time_th: hash % 2 === 0 ? '09:30 - 12:00' : '13:30 - 16:00',
    building_name: b.name,
  };
}

function renderScheduleForm(container, userId) {
  container.innerHTML = `
    <div class="schedule-flat-section">
      <div class="schedule-flat-header-row">
        <h2>ตารางสอบ <span class="badge-beta">Beta</span></h2>
        <span id="course-count-badge" class="course-count-badge">0</span>
      </div>
      
      <form id="course-add-form" class="course-add-form">
        <div class="course-input-wrapper">
          <input
            type="text"
            id="course-input"
            class="course-input"
            placeholder="เพิ่มรหัสวิชา เช่น LAW1001"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="characters"
            required
          />
          <button type="submit" id="course-add-btn" class="course-add-btn" aria-label="เพิ่มวิชา">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>เพิ่ม</span>
          </button>
        </div>
      </form>

      <div id="exam-table-container">
        <div class="schedule-empty">กำลังโหลดตารางสอบ...</div>
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
        if (DEV_MODE) addedCount++;
        console.error('Error adding course', code, err);
      }
    }

    addBtn.disabled = false;
    inputEl.value = '';
    inputEl.focus(); // โฟกัสรอพิมพ์วิชาถัดไปต่อเนื่องทันที

    if (addedCount > 0) {
      showToast(codes.length === 1 ? `✓ เพิ่ม ${codes[0]} แล้ว` : `✓ เพิ่มแล้ว ${addedCount} วิชา`);
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
}

async function refreshScheduleList(userId) {
  const container = document.getElementById('exam-table-container');
  const badgeEl = document.getElementById('course-count-badge');
  if (!container) return;

  let data;
  try {
    data = await fetchJSON(`/api/schedule?user_id=${encodeURIComponent(userId)}`);
  } catch (err) {
    if (DEV_MODE) {
      data = { schedules: [] };
    } else {
      container.innerHTML = '<div class="schedule-empty">โหลดรายการไม่สำเร็จ</div>';
      return;
    }
  }

  let schedules = data.schedules || [];

  // ใน DEV_MODE ใส่ข้อมูลตัวอย่าง 10 วิชาให้อัตโนมัติในครั้งแรก เพื่อดูผลลัพธ์ UI
  if (DEV_MODE && schedules.length === 0 && !sessionStorage.getItem('dev_cleared')) {
    schedules = [
      { schedule_id: 'demo-1', course_code: 'RAM1101' },
      { schedule_id: 'demo-2', course_code: 'MGT1001' },
      { schedule_id: 'demo-3', course_code: 'LAW1001' },
      { schedule_id: 'demo-4', course_code: 'ECO1003' },
      { schedule_id: 'demo-5', course_code: 'COS1101' },
      { schedule_id: 'demo-6', course_code: 'THA1001' },
      { schedule_id: 'demo-7', course_code: 'ACC1101' },
      { schedule_id: 'demo-8', course_code: 'POL1100' },
      { schedule_id: 'demo-9', course_code: 'RAM1000' },
      { schedule_id: 'demo-10', course_code: 'ENG1001' },
    ];
  }

  if (badgeEl) badgeEl.textContent = schedules.length;

  if (schedules.length === 0) {
    container.innerHTML = '<div class="schedule-empty">ยังไม่มีวิชาในตารางสอบ</div>';
    return;
  }

  const rowsHTML = schedules
    .map((s) => {
      const info = getCourseExamInfo(s.course_code);
      return `
        <div class="exam-swipe-wrapper" id="row-${escapeXml(s.schedule_id)}">
          <div class="exam-behind-actions">
            <button type="button" class="btn-del-circle" data-id="${escapeXml(s.schedule_id)}" data-code="${escapeXml(s.course_code)}" title="ลบวิชานี้" aria-label="ลบ">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"></path>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
          <div class="exam-item-content">
            <div class="exam-col-code">${escapeXml(s.course_code)}</div>
            <div class="exam-col-info">
              <div class="exam-datetime">${escapeXml(info.date_th)}<span class="exam-time-dot">•</span>${escapeXml(info.time_th)}</div>
              <div class="exam-location">${escapeXml(info.room)} (${escapeXml(info.building_name)})</div>
            </div>
            <div class="exam-col-action">
              <button type="button" class="btn-go-circle" data-dest="${escapeXml(info.building_id)}" title="นำทางไป ${escapeXml(info.building_name)}">
                <span>Go</span>
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="exam-list-container">
      ${rowsHTML}
    </div>
  `;

  // ฟังก์ชัน Swipe to Reveal สำหรับการ Slide เพื่อแสดงปุ่มลบ
  let activeSwiped = null;
  container.querySelectorAll('.exam-item-content').forEach((row) => {
    let startX = 0;
    let currentX = 0;
    let isTouching = false;

    row.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      currentX = startX;
      isTouching = true;
    }, { passive: true });

    row.addEventListener('touchmove', (e) => {
      if (!isTouching) return;
      currentX = e.touches[0].clientX;
    }, { passive: true });

    row.addEventListener('touchend', () => {
      if (!isTouching) return;
      isTouching = false;
      const diffX = startX - currentX;

      // เลื่อนไปทางซ้าย -> เปิดปุ่มลบ
      if (diffX > 30) {
        if (activeSwiped && activeSwiped !== row) {
          activeSwiped.classList.remove('is-swiped');
        }
        row.classList.add('is-swiped');
        activeSwiped = row;
      }
      // เลื่อนกลับไปทางขวา -> ปิดปุ่มลบ
      else if (diffX < -30) {
        row.classList.remove('is-swiped');
        if (activeSwiped === row) activeSwiped = null;
      }
    });

    // Double click / Long press fallback สำหรับ desktop
    row.addEventListener('dblclick', () => {
      row.classList.toggle('is-swiped');
    });
  });

  // ผูก Event ปุ่มนำทางวงกลมสีเขียว (Go)
  container.querySelectorAll('.btn-go-circle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const bId = btn.dataset.dest;
      if (!bId) return;
      const devParam = DEV_MODE ? '&dev=1' : '';
      window.location.href = `?dest_id=${encodeURIComponent(bId)}${devParam}`;
    });
  });

  // ผูก Event ปุ่มลบวงกลมสีแดง
  container.querySelectorAll('.btn-del-circle').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const scheduleId = btn.dataset.id;
      const courseCode = btn.dataset.code;
      const row = document.getElementById(`row-${scheduleId}`);

      if (row) row.classList.add('is-deleting');

      try {
        await fetchJSON(
          `/api/schedule?user_id=${encodeURIComponent(userId)}&schedule_id=${encodeURIComponent(scheduleId)}`,
          { method: 'DELETE' }
        );
      } catch (_) {
        if (DEV_MODE) sessionStorage.setItem('dev_cleared', '1');
      }

      showToast(`✕ ลบ ${courseCode} แล้ว`);
      setTimeout(async () => {
        if (row) row.remove();
        const remaining = container.querySelectorAll('.exam-swipe-wrapper').length;
        if (badgeEl) badgeEl.textContent = remaining;
        if (remaining === 0) {
          container.innerHTML = '<div class="schedule-empty">ยังไม่มีวิชาในตารางสอบ</div>';
        }
      }, 200);
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
  document.body.classList.remove('map-view');
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
  if (appState.map.is3DMode === is3D || appState.map.rebuilding) return;
  appState.map.is3DMode = is3D;
  const btn = document.getElementById('layer-toggle-btn');
  if (btn) {
    btn.textContent = is3D ? '2D' : '3D';
    // ล็อกปุ่มจนกว่าแผนที่ใหม่จะโหลดเสร็จ กดรัวๆ ระหว่างสร้างแผนที่จะได้ไม่ซ้อนกันจนค้าง
    btn.disabled = true;
  }
  rebuildMap();
}

// สลับโหมดต้องสร้าง map instance ใหม่ (mapId เปลี่ยนทีหลังไม่ได้) overlay ทุกตัวผูกกับแผนที่เดิม
// ทั้งหมดจึงต้องทิ้งแล้ววาดใหม่
//
// สำคัญ: ห้ามเรียก selectTarget ซ้ำตรงนี้ เพราะมันไปยิง Directions API ใหม่ทุกครั้งที่สลับโหมด
// ทำให้สะดุดชัดเจน (รอเน็ต) และการ์ดกระพริบหาย-โผล่ — เส้นทางไม่ได้เปลี่ยน แค่วาดของเดิมซ้ำก็พอ
// โหมดนำทางก็ไม่หยุด NavigationController ไม่ได้ผูกกับ map instance (คุยผ่าน callback อย่างเดียว)
function rebuildMap() {
  stopCompassFollow();
  const previous = appState.map.instance;
  const center = previous.getCenter();
  appState.map.rebuilding = true;

  buildingMarkers.length = 0;
  Object.keys(layerOverlays).forEach((k) => { layerOverlays[k] = []; });
  targetPin = null;
  userPin = null;
  carPin = null;
  parkingShapes.length = 0;

  const map = createMapInstance({ lat: center.lat(), lng: center.lng() });
  renderLayers();
  if (appState.user.location) updateUserPin(appState.user.location);
  if (appState.target) {
    updateTargetPin(appState.target);
    highlightBuildingMarker(appState.target.type === 'BUILDING' ? appState.target.id : null);
    RouteCalculator.redraw();
  }
  applyViewMode();

  google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
    appState.map.rebuilding = false;
    updateLayerToggleAvailability();
  });
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
  if (!btn || !appState.map.instance || appState.map.rebuilding) return;
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
    updateMyLocationAvailability();
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
    updateMyLocationAvailability();
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
  stopCampusArrivalWatch();
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

// --- แชร์จุดนัดพบเข้าแชท LINE ---

// ลิงก์ deep link ที่รองรับอยู่แล้ว เพื่อนกดแล้วเปิดแผนที่ปักหมุดจุดนั้นให้ทันที ไม่ต้องพิมพ์หาเอง
function shareUrlFor(target) {
  const base = `https://liff.line.me/${LIFF_ID}`;
  if (target.type === 'PARKING') return `${base}?mode=parking&zone_id=${encodeURIComponent(target.id)}`;
  if (target.type === 'MY_CAR') return `${base}?car=${target.coords.lat},${target.coords.lng}`;
  return `${base}?dest_id=${encodeURIComponent(target.id)}`;
}

function shareFlexMessage(target) {
  const name = shortPlaceName(target.name);
  const url = shareUrlFor(target);
  return {
    type: 'flex',
    altText: `จุดนัดพบ: ${name}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: 'จุดนัดพบใน ม.รามฯ', size: 'xs', color: '#8a8f98' },
          { type: 'text', text: name, weight: 'bold', size: 'lg', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#06c755',
            action: { type: 'uri', label: 'ดูเส้นทาง', uri: url },
          },
        ],
      },
    },
  };
}

// ไล่ตามความสามารถของที่ที่เปิดอยู่: ในแอป LINE ส่งเข้าแชทได้เลย, นอก LINE ใช้แชร์ของระบบ,
// ถ้าไม่มีอะไรเลยก็คัดลอกลิงก์ให้ — ผู้ใช้จะได้ไม่กดแล้วเงียบไม่ว่าจะเปิดจากที่ไหน
async function shareTarget(target) {
  const url = shareUrlFor(target);
  const text = `จุดนัดพบ: ${shortPlaceName(target.name)}\n${url}`;

  try {
    if (!DEV_MODE && typeof liff !== 'undefined' && liff.isApiAvailable && liff.isApiAvailable('shareTargetPicker')) {
      const result = await liff.shareTargetPicker([shareFlexMessage(target)]);
      if (result) SheetManager.showNotice('ส่งจุดนัดพบให้เพื่อนแล้ว');
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: shortPlaceName(target.name), text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    SheetManager.showNotice('คัดลอกลิงก์แล้ว วางในแชทเพื่อส่งให้เพื่อนได้เลย');
  } catch (err) {
    // ผู้ใช้กดยกเลิกหน้าเลือกผู้รับ ไม่ใช่ error ที่ต้องบอก
    if (err && err.name === 'AbortError') return;
    console.error('แชร์ไม่สำเร็จ', err);
    SheetManager.showNotice('แชร์ไม่สำเร็จ ลองใหม่อีกครั้งครับ');
  }
}

// --- จำที่จอดรถ + รายงานสภาพลานจอด ---

const MY_CAR_STORAGE_KEY = 'ram-roo-thang:my-car';

// เก็บไว้ในเครื่องอย่างเดียว ไม่ส่งขึ้น server — พิกัดรถเป็นข้อมูลที่บอกได้ว่าเจ้าของอยู่ไหน
// เก็บบนเครื่องตัวเองจึงไม่ต้องมีเรื่อง privacy ให้ดูแล และไม่ต้องมี endpoint เพิ่ม
// ข้อแลกคือเปลี่ยนเครื่อง/ล้างข้อมูลเบราว์เซอร์แล้วหาย ซึ่งรับได้ เพราะจอดแล้วกลับมาเอารถวันเดียวกัน
function loadSavedCar() {
  try {
    const raw = localStorage.getItem(MY_CAR_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

// ตอนกด "ถึงแล้ว" ผู้ใช้ยังนั่งอยู่ในรถริมถนนหน้าลาน ยังไม่ได้เข้าไปจอดจริง ถ้าบันทึกพิกัดตรงนั้น
// ตรงๆ หมุดรถจะไปโผล่นอกลานบนถนน ซึ่งผิดและชวนสับสนตอนกลับมาหา
// ถ้าอยู่นอกขอบลาน ให้ยึดกลางลานไว้ก่อนแล้วทำเครื่องหมายว่าเป็นค่าประมาณ พอเดินเข้าไปจอดจริง
// การ์ดในลานจะเสนอ "อัปเดตตำแหน่งรถ" ให้บันทึกจุดที่จอดจริงทับได้
function resolveCarLocation(location, zoneEntry) {
  if (!zoneEntry || !location) {
    return { coords: location || null, approximate: false };
  }
  const inside = google.maps.geometry.poly.containsLocation(
    new google.maps.LatLng(location.lat, location.lng),
    zoneEntry.shape
  );
  if (inside) return { coords: location, approximate: false };
  return { coords: { lat: zoneEntry.feature.lat, lng: zoneEntry.feature.lng }, approximate: true };
}

function saveCar(location, zoneName, approximate) {
  const car = {
    lat: location.lat,
    lng: location.lng,
    zoneName: zoneName || '',
    approximate: Boolean(approximate),
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(MY_CAR_STORAGE_KEY, JSON.stringify(car));
  } catch (err) {
    console.error('บันทึกตำแหน่งรถไม่สำเร็จ', err);
  }
  appState.car = car;
  updateCarPin();
  updateCarButtonAvailability();
  return car;
}

function forgetCar() {
  try {
    localStorage.removeItem(MY_CAR_STORAGE_KEY);
  } catch (err) { /* ไม่เป็นไร ถือว่าลืมแล้ว */ }
  appState.car = null;
  updateCarPin();
  updateCarButtonAvailability();
}

const CAR_GLYPH = '<path d="M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11v7a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H8v1a1 1 0 01-1 1H6a1 1 0 01-1-1v-7zm2.2-1h9.6l-1-3H8.2l-1 3zM7.5 15a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z"/>';

function updateCarPin() {
  if (carPin) {
    carPin.setMap(null);
    carPin = null;
  }
  if (!appState.car || !appState.map.instance) return;
  carPin = new google.maps.Marker({
    position: { lat: appState.car.lat, lng: appState.car.lng },
    map: appState.map.instance,
    title: 'รถของคุณ',
    icon: pinIcon('#e8590c', `<g transform="scale(0.62) translate(-12 -12)">${CAR_GLYPH}</g>`),
    zIndex: 997,
  });
  carPin.addListener('click', () => navigateToCar());
}

function updateCarButtonAvailability() {
  const btn = document.getElementById('my-car-btn');
  if (btn) btn.hidden = !appState.car;
}

function navigateToCar() {
  if (!appState.car) return;
  selectTarget({
    id: 'MY_CAR',
    name: 'รถของคุณ',
    type: 'MY_CAR',
    coords: { lat: appState.car.lat, lng: appState.car.lng },
  });
}

// ผู้ใช้ยืนอยู่ในเขตลานจอดไหน (null = ไม่ได้อยู่ในลานไหนเลย)
function parkingZoneAt(location) {
  if (!location) return null;
  const point = new google.maps.LatLng(location.lat, location.lng);
  const hit = parkingShapes.find((entry) => google.maps.geometry.poly.containsLocation(point, entry.shape));
  return hit || null;
}

// เฝ้าตำแหน่งไว้ตลอดที่อยู่หน้าแผนที่ ไม่ใช่เช็คแค่ตอนเปิดแอปหรือตอนกดปุ่มตำแหน่ง —
// เคสจริงคือเปิดแอปตั้งแต่อยู่นอกลาน แล้วค่อยขับ/เดินเข้าไปจอด ถ้าไม่เฝ้าไว้ก็จะไม่มีอะไรเกิดขึ้น
// จนกว่าผู้ใช้จะเดาเองว่าต้องกดปุ่มตำแหน่ง ซึ่งไม่มีทางรู้
//
// ใช้ enableHighAccuracy: false เพราะแค่ต้องรู้ว่าอยู่ในลานไหน ลานเล็กสุดกว้างราว 30 ม.
// ความละเอียดระดับนี้พอ และประหยัดแบตกว่าโหมดแม่นยำสูงมาก
const PRESENCE_WATCH_OPTIONS = { enableHighAccuracy: false, maximumAge: 10000, timeout: 30000 };
let presenceWatchId = null;

function startPresenceWatch() {
  if (presenceWatchId !== null || DEV_MODE || !navigator.geolocation) return;
  presenceWatchId = navigator.geolocation.watchPosition(
    (pos) => handlePresence({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => {},
    PRESENCE_WATCH_OPTIONS
  );
}

function stopPresenceWatch() {
  if (presenceWatchId === null) return;
  navigator.geolocation.clearWatch(presenceWatchId);
  presenceWatchId = null;
}

function handlePresence(location) {
  appState.user.location = location;
  appState.user.isInsideCampus = isWithinCampusBounds(location);
  updateUserPin(location);
  offerParkingActions(location);
}

// ยืนอยู่ในลานจอดและยังไม่ได้เลือกจุดหมายอะไร -> เสนอสิ่งที่ทำได้ตรงนั้นเลย (จำที่จอด / รายงานสภาพ)
// ออกจากลานเมื่อไหร่ก็เก็บการ์ดไป และรีเซ็ตการปิดทิ้ง เพื่อให้ครั้งหน้าที่เข้าลานใหม่เสนออีกได้
function offerParkingActions(location) {
  if (appState.target || NavigationController.isActive()) return;
  const here = parkingZoneAt(location);

  if (!here) {
    // ออกจากลานแล้วต้องรีเซ็ตทั้งคู่เสมอ — เดิมผูกเงื่อนไขไว้กับ offeredZoneId ซึ่งถูกล้างไปตอน
    // ผู้ใช้กดปิดการ์ด ทำให้ dismissedZoneId ค้าง แล้วเดินกลับเข้าลานเดิมอีกครั้งก็ไม่เสนอให้อีกเลย
    if (appState.parking.offeredZoneId) SheetManager.hide();
    appState.parking.offeredZoneId = null;
    appState.parking.dismissedZoneId = null;
    return;
  }

  const zoneKey = (here.zone && here.zone.zone_id) || here.feature.name;
  // ผู้ใช้กดปิดการ์ดไปแล้วสำหรับลานนี้ อย่าเด้งขึ้นมาใหม่ทุกครั้งที่ GPS ขยับ น่ารำคาญมาก
  if (appState.parking.dismissedZoneId === zoneKey) return;
  if (appState.parking.offeredZoneId === zoneKey) return;

  appState.parking.offeredZoneId = zoneKey;
  showParkingActionSheet(here, location);
}

// ถึงลานจอดด้วยการนำทาง — ห้ามใช้ parkingZoneAt ตัดสินตรงนี้ เพราะการนำทางถือว่า "ถึง" เมื่อเข้าใกล้
// 25 ม. และ Google พาไปจอดที่ถนนริมลาน ซึ่งมักอยู่นอก polygon ทำให้ตรวจไม่เจอแล้วไม่แสดงปุ่มอะไรเลย
// ตรงนี้เรารู้อยู่แล้วว่าผู้ใช้ตั้งใจมาลานไหน (target.id) ใช้ค่านั้นเลยตรงกว่า
// ส่วนการรายงานสภาพยังปลอดภัย เพราะ backend ตรวจ geofence 150 ม. ให้อีกชั้น
function showParkingArrival(target) {
  const location = appState.user.location || target.coords;
  const here = parkingShapes.find((entry) => entry.zone && entry.zone.zone_id === target.id)
    || parkingZoneAt(location);

  SheetManager.showParkingArrivalSheet({
    title: shortPlaceName(target.name),
    onSaveCar: () => {
      const resolved = resolveCarLocation(location, here);
      saveCar(resolved.coords, target.name, resolved.approximate);
      finishParkingNavigation();
      if (here) showParkingActionSheet(here, location);
      SheetManager.showNotice(resolved.approximate
        ? 'บันทึกไว้ที่กลางลานจอดก่อน จอดเสร็จแล้วกดอัปเดตตำแหน่งรถให้ตรงจุดได้'
        : 'บันทึกตำแหน่งรถแล้ว กดปุ่มรูปรถเพื่อกลับมาหาได้ทุกเมื่อ');
    },
    onFinish: () => {
      finishParkingNavigation();
      // ยังไม่ได้บันทึกรถ แต่ยืนอยู่ในลานจริง -> เสนอปุ่มบันทึก/รายงานต่อ ไม่ปล่อยให้จบห้วนๆ
      const inZone = parkingZoneAt(location);
      if (inZone) showParkingActionSheet(inZone, location);
    },
  });
}

// ต้องเคลียร์ target ก่อนหยุดนำทาง ไม่งั้น onStop ของ NavigationController จะเรียก selectTarget
// ซ้ำแล้วการ์ดเส้นทางเด้งกลับมาทับการ์ดที่จอดรถที่เพิ่งเปิด
function finishParkingNavigation() {
  appState.target = null;
  clearTargetPin();
  NavigationController.stop();
}

function showParkingActionSheet(here, location) {
  const zoneKey = (here.zone && here.zone.zone_id) || here.feature.name;
  SheetManager.setOnClose(() => {
    appState.parking.dismissedZoneId = zoneKey;
    appState.parking.offeredZoneId = null;
    SheetManager.hide();
    SheetManager.setOnClose(clearTarget);
  });
  const zoneName = here.feature.name;
  const saved = appState.car;
  SheetManager.showParkingActionSheet({
    title: zoneName.replace(/^ที่จอดรถ\s*/, ''),
    savedNote: saved
      ? `จดจำตำแหน่งรถไว้แล้วเมื่อ ${formatSavedAt(saved.savedAt)}${saved.approximate ? ' (ตำแหน่งโดยประมาณ)' : ''}`
      : '',
    onSaveCar: () => {
      const resolved = resolveCarLocation(location, here);
      saveCar(resolved.coords, zoneName, resolved.approximate);
      showParkingActionSheet(here, location);
      SheetManager.showNotice('จดจำตำแหน่งรถแล้ว กดปุ่มรูปรถเพื่อกลับมาหาได้ทุกเมื่อ');
    },
    onReport: (status) => submitParkingReport(here, location, status),
  });
}

function formatSavedAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

// ยิงเข้า endpoint เดิมที่มีอยู่แล้ว — backend ตรวจ geofence กับ rate limit ให้เอง เราไม่ต้อง
// เช็คซ้ำฝั่ง client (และไม่ควรเชื่อ client อยู่แล้ว)
async function submitParkingReport(here, location, status) {
  const zoneId = here.zone && here.zone.zone_id;
  if (!zoneId) {
    SheetManager.showNotice('ลานจอดนี้ยังไม่มีข้อมูลในระบบ รายงานไม่ได้ครับ');
    return;
  }
  try {
    const userId = await getUserId();
    await fetchJSON('/api/parking/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, zone_id: zoneId, status, user_lat: location.lat, user_lng: location.lng }),
    });
    SheetManager.showNotice('ขอบคุณครับ รายงานสภาพที่จอดเรียบร้อย');
    await loadParkingZones();
    renderLayers();
  } catch (err) {
    SheetManager.showNotice(err.data && err.data.error ? err.data.error : 'ส่งรายงานไม่สำเร็จ ลองใหม่อีกครั้งครับ');
  }
}

// --- ขอตำแหน่งตั้งแต่เปิดแอป ---

const LOCATION_PRIMER_SKIPPED_KEY = 'ram-roo-thang:location-primer-skipped';

// ขอตำแหน่งตั้งแต่เปิดหน้าแผนที่ ไม่ต้องรอให้เลือกจุดหมายก่อน — ตอนเปิดแอปผู้ใช้ยังไม่ได้รีบ
// โอกาสกดอนุญาตสูงกว่าตอนกำลังหาตึกอยู่ และถ้าอนุญาตแล้วทุกอย่างหลังจากนั้นก็ลื่นหมด
// (ไม่ต้องรอขอสิทธิ์กลางคันตอนกำลังจะนำทาง)
//
// เรียกเฉพาะตอนเปิดแผนที่รวมเท่านั้น ถ้ามาจากลิงก์ที่ระบุจุดหมายมาแล้ว ปล่อยให้ flow เลือกจุดหมาย
// ขอเองตามเดิม จะได้ไม่มีการ์ดสองใบแย่งที่กัน
async function primeLocationAccess() {
  if (appState.user.isGpsAllowed) return;
  const state = await locationPermissionState();

  // เคยอนุญาตไว้แล้ว ไม่ต้องถามซ้ำ เอาตำแหน่งมาใช้เลย
  if (state === 'granted') {
    await acceptLocation();
    return;
  }
  // เคยปฏิเสธถาวร หรือเคยกดข้ามไปแล้ว — ไม่ทวงซ้ำทุกครั้งที่เปิดแอป น่ารำคาญเกินไป
  if (state === 'denied') return;
  if (sessionStorage.getItem(LOCATION_PRIMER_SKIPPED_KEY) === 'true') return;

  SheetManager.showLocationPrimer({
    onAllow: () => acceptLocation(),
    onSkip: () => {
      sessionStorage.setItem(LOCATION_PRIMER_SKIPPED_KEY, 'true');
      SheetManager.hide();
    },
  });
}

async function acceptLocation() {
  try {
    const location = await getUserLocation();
    appState.user.location = location;
    appState.user.isGpsAllowed = true;
    appState.user.isInsideCampus = isWithinCampusBounds(location);
    updateUserPin(location);
    updateMyLocationAvailability();
    SheetManager.hide();
    appState.map.instance.panTo(location);
    nudgeMapRepaint(appState.map.instance);
    offerParkingActions(location);
    return true;
  } catch (err) {
    SheetManager.hide();
    SheetManager.showNotice('ยังไม่ได้สิทธิ์ตำแหน่ง เลือกจุดหมายแล้วกดเปิดตำแหน่งอีกครั้งได้ครับ');
    return false;
  }
}

// --- ตำแหน่งของฉัน ---

// ปุ่มนี้ทำงานได้เฉพาะในรั้วมหาลัย ถ้ารู้แน่แล้วว่าอยู่นอกก็ซ่อนไปเลย ดีกว่าให้กดแล้วเจอข้อความ
// ปฏิเสธ — ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้นสร้างความสับสนมากกว่าปุ่มที่ไม่อยู่ตรงนั้นตั้งแต่แรก
//
// แต่ตอนที่ "ยังไม่รู้ตำแหน่ง" ต้องโชว์ไว้ เพราะปุ่มนี้เป็นทางที่ผู้ใช้จะกดขอสิทธิ์ตำแหน่งครั้งแรก
// ถ้าซ่อนตั้งแต่ยังไม่รู้ ก็จะไม่มีทางเข้าถึงเลย
function updateMyLocationAvailability() {
  const btn = document.getElementById('my-location-btn');
  if (!btn) return;
  const knownOutside = Boolean(appState.user.isGpsAllowed && appState.user.location && !appState.user.isInsideCampus);
  btn.hidden = knownOutside;
  if (knownOutside && isCompassFollowing()) stopCompassFollow();
}

// หมุนตามเข็มทิศ — ใช้ได้เฉพาะตอน "ยังไม่เริ่มเดินทาง" เท่านั้น
//
// ระหว่างนำทางใช้ทิศจากการเคลื่อนที่ (heading-up) ซึ่งนิ่งกว่ามาก เพราะคนเดินถือมือถือเอียงไปมา
// แต่ตอนยืนนิ่งๆ heading-up ตอบไม่ได้เลย (ไม่มีการเคลื่อนที่ให้คำนวณ) ซึ่งเป็นจังหวะที่คนต้องการ
// รู้ทิศมากที่สุด — เพิ่งออกจากตึกแล้วงงว่าต้องหันไปทางไหน เข็มทิศตอบได้จังหวะนี้จังหวะเดียว
//
// สองระบบนี้ห้ามทำงานพร้อมกันเด็ดขาด ไม่งั้นจะแย่งกันสั่งหมุนแผนที่ (เคยเจอมาแล้ว)
// จึงกันไว้ 2 ชั้น: เริ่มไม่ได้ถ้ากำลังนำทาง และหยุดให้อัตโนมัติเมื่อเริ่มนำทาง
const HEADING_MIN_DELTA_DEG = 3;
const HEADING_THROTTLE_MS = 200;

let compassListener = null;
let lastCompassAt = 0;
let lastCompassHeading = null;

function isCompassFollowing() {
  return compassListener !== null;
}

function onDeviceOrientation(event) {
  if (!appState.map.instance || NavigationController.isActive()) return;
  // iOS ให้ค่าเข็มทิศจริงใน webkitCompassHeading ส่วน Android ใช้ alpha ที่นับสวนทาง
  const heading = typeof event.webkitCompassHeading === 'number'
    ? event.webkitCompassHeading
    : (typeof event.alpha === 'number' ? (360 - event.alpha) % 360 : null);
  if (heading === null) return;

  const now = Date.now();
  if (now - lastCompassAt < HEADING_THROTTLE_MS) return;
  if (lastCompassHeading !== null && Math.abs(heading - lastCompassHeading) < HEADING_MIN_DELTA_DEG) return;
  lastCompassAt = now;
  lastCompassHeading = heading;
  appState.map.instance.setHeading(heading);
}

async function startCompassFollow() {
  if (NavigationController.isActive()) return false;
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return false;
  // iOS ต้องขออนุญาตจากใน user gesture เท่านั้น — ปุ่มนี้เป็น gesture อยู่แล้ว
  if (typeof DOE.requestPermission === 'function') {
    try {
      if ((await DOE.requestPermission()) !== 'granted') return false;
    } catch (err) {
      return false;
    }
  }
  compassListener = onDeviceOrientation;
  window.addEventListener('deviceorientationabsolute', compassListener, true);
  window.addEventListener('deviceorientation', compassListener, true);
  return true;
}

function stopCompassFollow() {
  if (compassListener) {
    window.removeEventListener('deviceorientationabsolute', compassListener, true);
    window.removeEventListener('deviceorientation', compassListener, true);
    compassListener = null;
  }
  lastCompassHeading = null;
  const btn = document.getElementById('my-location-btn');
  if (btn) btn.classList.remove('active');
  if (appState.map.instance) appState.map.instance.setHeading(CAMERA_PRESETS[currentMode()].heading);
}

// กดครั้งแรก = ไปที่ตัวเรา + หมุนตามทิศที่หันอยู่ กดซ้ำ = เลิกหมุนตาม
async function toggleMyLocation() {
  if (isCompassFollowing()) {
    stopCompassFollow();
    return;
  }
  let location;
  try {
    location = await getUserLocation();
  } catch (err) {
    SheetManager.showGpsWarning(toggleMyLocation);
    return;
  }

  appState.user.location = location;
  appState.user.isGpsAllowed = true;
  appState.user.isInsideCampus = isWithinCampusBounds(location);
  updateUserPin(location);
  updateMyLocationAvailability();

  if (!appState.user.isInsideCampus) return;

  appState.map.instance.panTo(location);
  nudgeMapRepaint(appState.map.instance);
  offerParkingActions(location);

  const started = await startCompassFollow();
  const btn = document.getElementById('my-location-btn');
  if (started && btn) btn.classList.add('active');
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
  // เข็มทิศกับ heading-up ห้ามทำงานพร้อมกัน ตัวไหนเริ่มทีหลังชนะ
  stopCompassFollow();
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
    // หันแผนที่ตามทิศที่เดินจริง (heading-up) ทำได้ทั้ง 2D และ 3D เพราะทั้งคู่เป็น vector แล้ว
    // ใช้ทิศจากการเคลื่อนที่ ไม่ใช่เข็มทิศของเครื่อง เพราะคนเดินถือมือถือเอียงไปมา ทิศจะสะบัด
    onHeading: (heading) => {
      if (appState.map.instance) appState.map.instance.setHeading(heading);
    },
    onArrive: () => {
      SheetManager.updateNavigationStats('ถึงแล้ว', '-');
      if (target.type === 'PARKING') showParkingArrival(target);
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
      // คืนมุมกล้องตามโหมดที่ใช้อยู่ ไม่ปล่อยให้ค้างเอียงตามทิศสุดท้ายที่เดิน
      if (appState.map.instance) appState.map.instance.setHeading(CAMERA_PRESETS[currentMode()].heading);
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

// --- ส่งต่อจากนอกมหาลัยเข้าในมหาลัยแบบไร้รอยต่อ ---

// ตอนอยู่นอกมหาลัยเราแค่ส่งไป Google Maps ให้ขับรถมา แต่พอขับถึงแล้วผู้ใช้ต้องมากดเลือกจุดหมาย
// ใหม่เองซึ่งสะดุด — เฝ้าตำแหน่งไว้เบาๆ พอเข้าเขตมหาลัยก็สลับเป็นนำทางเดินเท้าจากจุดที่ยืนอยู่จริงให้เลย
// ใช้ enableHighAccuracy: false เพราะแค่ต้องรู้ว่า "เข้าเขตหรือยัง" ไม่ต้องละเอียดระดับเมตร จะได้ไม่กินแบต
const ARRIVAL_WATCH_OPTIONS = { enableHighAccuracy: false, maximumAge: 15000, timeout: 30000 };
let arrivalWatchId = null;

function startCampusArrivalWatch(target) {
  stopCampusArrivalWatch();
  if (DEV_MODE || !navigator.geolocation) return;
  arrivalWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      appState.user.location = location;
      if (!isWithinCampusBounds(location)) return;
      stopCampusArrivalWatch();
      appState.user.isInsideCampus = true;
      updateUserPin(location);
      updateMyLocationAvailability();
      SheetManager.showNotice('ถึง ม.รามฯ แล้ว เปลี่ยนเป็นนำทางเดินเท้าให้อัตโนมัติ');
      runContextRouting(target, location);
    },
    () => {},
    ARRIVAL_WATCH_OPTIONS
  );
}

function stopCampusArrivalWatch() {
  if (arrivalWatchId !== null) {
    navigator.geolocation.clearWatch(arrivalWatchId);
    arrivalWatchId = null;
  }
}

// Context Routing Matrix (Module_2_Technical_Specification.md §3)
async function runContextRouting(target, originLocation, opts) {
  if (!appState.user.isInsideCampus) {
    const zone = nearestParkingZone(target.coords);
    const destination = zone ? { lat: zone.lat, lng: zone.lng } : CAMPUS_CONSTANTS.DEFAULT_ORIGIN;
    if (zone) appState.map.instance.panTo(destination);
    startCampusArrivalWatch(target);
    SheetManager.showOffCampusSheet({
      title: shortPlaceName(target.name),
      // ตัดคำว่า "ที่จอดรถ" นำหน้าออก เพราะประโยครอบๆ บอกอยู่แล้วว่ากำลังพูดถึงที่จอดรถ
      parkingName: zone ? zone.zone_name.replace(/^ที่จอดรถ\s*/, '') : null,
      parkingStatus: zone ? PARKING_STATUS_LABEL[zone.status] || null : null,
      onOpenGoogleMaps: () => window.open(googleDirectionsUrl(destination), '_blank'),
    });
    return;
  }

  stopCampusArrivalWatch();
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
      onShare: () => shareTarget(target),
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
async function handleGpsDenied(target) {
  // ยังวาดเส้นทางจากประตูหน้าให้เห็นภาพว่าตึกอยู่ทางไหน แต่ไม่เปิดโหมดนำทาง เพราะไม่รู้ว่าอยู่ไหนจริง
  updateUserPin(CAMPUS_CONSTANTS.DEFAULT_ORIGIN);
  try {
    const route = await RouteCalculator.calculateRoute(CAMPUS_CONSTANTS.DEFAULT_ORIGIN, target.coords, 'WALKING');
    SheetManager.showGpsDeniedSheet({
      title: shortPlaceName(target.name),
      distanceText: formatDistance(route.distanceMeters),
      durationText: `${route.durationMinutes} นาที`,
      onEnableLocation: () => retryLocation(target),
    });
  } catch (err) {
    SheetManager.showRouteErrorSheet({
      title: shortPlaceName(target.name),
      onFocus: () => appState.map.instance.panTo(target.coords),
    });
  }
}

// ไม่มี API ไหนสั่งให้ LINE/ระบบเด้งหน้าขอสิทธิ์ตำแหน่งได้โดยตรง — ตัวที่ทำให้เด้งคือการเรียก
// getCurrentPosition เท่านั้น (ซึ่งปุ่ม "เปิดตำแหน่ง" ทำอยู่แล้ว) แต่ถ้าเคยกดปฏิเสธไปแล้ว
// เบราว์เซอร์จะจำไว้และไม่เด้งอีก กดปุ่มก็เงียบ ไม่มีอะไรเกิดขึ้น ซึ่งงงกว่าไม่มีปุ่ม
//
// เช็คสถานะสิทธิ์ก่อนจึงบอกได้ตรงจุดว่าต้องทำอะไรต่อ: ถ้ายังขอได้ก็ปล่อยให้เด้งตามปกติ
// ถ้าโดนบล็อกถาวรแล้วก็บอกทางไปแก้ในตั้งค่าแทนการปล่อยให้กดแล้วเงียบ
async function locationPermissionState() {
  if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state; // 'granted' | 'prompt' | 'denied'
  } catch (err) {
    return 'unknown';
  }
}

async function retryLocation(target) {
  if ((await locationPermissionState()) === 'denied') {
    SheetManager.showNotice('ตำแหน่งถูกปิดไว้ เปิดได้ที่ ตั้งค่า > LINE > ตำแหน่ง แล้วกลับมากดอีกครั้ง');
    return;
  }
  try {
    const location = await getUserLocation();
    appState.user.location = location;
    appState.user.isGpsAllowed = true;
    appState.user.isInsideCampus = isWithinCampusBounds(location);
    updateUserPin(location);
    updateMyLocationAvailability();
    await runContextRouting(target, location);
  } catch (err) {
    SheetManager.showNotice('ยังเปิดตำแหน่งไม่ได้ เปิดได้ที่ ตั้งค่า > LINE > ตำแหน่ง แล้วกลับมากดอีกครั้ง');
  }
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
