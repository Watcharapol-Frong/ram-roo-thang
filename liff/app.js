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
  parkingZones: [], // โหลดจาก /api/parking/zones — ใช้ทั้งทาสีเลเยอร์และหาลานจอดใกล้จุดหมาย
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

// แผนที่รวมทุกอย่างจาก data/ru_master.geojson (93 จุด) ไว้ในหน้าเดียว แล้วให้ผู้ใช้กรองเอาเองด้วย
// ชิปเลือกเลเยอร์ด้านบน — โหลดเป็นไฟล์ static จาก LIFF ตรงๆ ไม่ผ่าน KV เพราะเป็นข้อมูลนิ่งล้วนๆ
// (สถานะลานจอดที่เปลี่ยนตามเวลายังดึงจาก /api/parking/zones แล้วมาทาสีทับทีหลัง)
const MASTER_GEOJSON_URL = 'data/ru_master.geojson';

// "อื่นๆ" = ทุกอย่างที่ไม่ใช่อาคารและไม่ใช่ที่จอดรถ (ร้านค้า + จุดสังเกต) ตามที่ทีมกำหนด
// หมายเหตุ: category ในไฟล์ต้นทางสะกดว่า "orther" (พิมพ์ผิดตั้งแต่ต้นทาง) — ไม่แก้ไฟล์ต้นทาง
// เพื่อให้ sync กับของทีมได้ตรงๆ แต่รับค่าทั้งสองแบบไว้เผื่อวันหลังมีคนแก้
const MAP_LAYERS = [
  { id: 'building', label: '🏛 อาคาร', categories: ['building'] },
  { id: 'parking', label: '🚗 ที่จอดรถ', categories: ['parking'] },
  { id: 'other', label: '📍 อื่นๆ', categories: ['shop', 'orther', 'other'] },
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
// 400 ม. -> zoom ~16.42 (ภาพรวมทั้งแคมปัส) / 165 ม. -> zoom ~17.70 (ใกล้พอเห็นอาคาร 3D)
const ZOOM_REFERENCE_ALTITUDE_M = 35200000;

const CAMERA_PRESETS = {
  '2d': { altitudeMeters: 400, tilt: 0, heading: 0 },
  '3d': { altitudeMeters: 165, tilt: 60, heading: 20 },
};

function altitudeToZoom(altitudeMeters) {
  return Math.log2(ZOOM_REFERENCE_ALTITUDE_M / altitudeMeters);
}

// ป้ายชิปต้องเห็นตั้งแต่มุมมองเริ่มต้น เพราะตอนนี้อาคารแสดงเป็นป้ายอย่างเดียว ไม่มีรูปทรงให้เห็นแล้ว
// ถ้าตั้งเกณฑ์สูงกว่า zoom เริ่มต้น พอเปิดหน้ามาจะไม่เห็นอาคารเลยสักหลัง — ผูกกับ preset 2D ไว้
// จะได้ไม่เพี้ยนถ้าวันหลังมีคนแก้ความสูงกล้อง (เผื่อไว้ 0.5 ระดับสำหรับตอนผู้ใช้ซูมออกเอง)
const BUILDING_MARKER_MIN_ZOOM = altitudeToZoom(CAMERA_PRESETS['2d'].altitudeMeters) - 0.5;

let masterFeatures = null;
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
      <div class="map-top-bar">
        <div class="layer-chips" id="layer-chips"></div>
        <button class="layer-toggle-btn" id="layer-toggle-btn">🏢 3D</button>
      </div>
      <div id="notice-bar-slot"></div>
      <div id="action-sheet-slot"></div>
    </div>
  `;
  document.getElementById('layer-toggle-btn').addEventListener('click', toggle3D);

  buildingMarkers.length = 0;
  Object.keys(layerOverlays).forEach((k) => { layerOverlays[k] = []; });

  appState.map.instance = new google.maps.Map(document.getElementById('map'), {
    center: CAMPUS_CONSTANTS.INITIAL_VIEW.center,
    zoom: altitudeToZoom(CAMERA_PRESETS['2d'].altitudeMeters),
    tilt: CAMERA_PRESETS['2d'].tilt,
    heading: CAMERA_PRESETS['2d'].heading,
    mapId: GOOGLE_MAPS_MAP_ID,
    disableDefaultUI: true,
    zoomControl: false,
    clickableIcons: false,
  });
  RouteCalculator.init(appState.map.instance);
  appState.map.instance.addListener('center_changed', updateLayerToggleAvailability);
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
  google.maps.event.addListenerOnce(appState.map.instance, 'tilesloaded', applyViewMode);
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

// --- Layer chips (กดเลือกได้หลายอัน เลเยอร์ที่ไม่ได้เลือกจะถูกซ่อน) ---

function renderLayerChips() {
  const slot = document.getElementById('layer-chips');
  if (!slot) return;
  slot.innerHTML = MAP_LAYERS.map((layer) => {
    const on = appState.map.activeLayers.has(layer.id);
    return `<button class="layer-chip${on ? ' active' : ''}" data-layer="${layer.id}">${layer.label}</button>`;
  }).join('');

  slot.querySelectorAll('.layer-chip').forEach((btn) => {
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
  appState.map.is3DMode = !appState.map.is3DMode;
  applyViewMode();
  btn.textContent = appState.map.is3DMode ? '🗺 2D' : '🏢 3D';
  btn.classList.toggle('active', appState.map.is3DMode);
}

function applyViewMode() {
  const map = appState.map.instance;
  const preset = CAMERA_PRESETS[appState.map.is3DMode ? '3d' : '2d'];
  map.setZoom(altitudeToZoom(preset.altitudeMeters));
  map.setTilt(preset.tilt);
  map.setHeading(preset.heading);
  nudgeMapRepaint(map);
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
  if (!allowed && appState.map.is3DMode) {
    appState.map.is3DMode = false;
    applyViewMode();
    btn.textContent = '🏢 3D';
    btn.classList.remove('active');
  }
}

// ผู้ใช้แตะเลือกอาคาร/ลานจอด/ร้านค้าจากแผนที่ (หรือถูกเลือกให้อัตโนมัติจาก dest_id/zone_id) —
// จุดเริ่มต้นของ Context Routing Matrix (§3) ทั้งหมด
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

// Context Routing Matrix (Module_2_Technical_Specification.md §3)
async function runContextRouting(target, originLocation, opts) {
  if (!appState.user.isInsideCampus) {
    const zone = nearestParkingZone(target.coords);
    const destination = zone ? { lat: zone.lat, lng: zone.lng } : CAMPUS_CONSTANTS.DEFAULT_ORIGIN;
    if (zone) appState.map.instance.panTo(destination);
    SheetManager.showOffCampusSheet({
      title: target.name,
      parkingName: zone ? zone.zone_name : null,
      parkingStatus: zone ? PARKING_STATUS_LABEL[zone.status] || null : null,
      onOpenGoogleMaps: () => window.open(googleDirectionsUrl(destination), '_blank'),
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

// GPS Denied Fallback (§3 แถว Fallback, AC-04) — พฤติกรรมเดิมไม่เปลี่ยน: โชว์แถบเตือนพร้อมกับแผนที่
// (ไม่ใช่แทนที่กัน) แล้วคำนวณเส้นทางจาก DEFAULT_ORIGIN ให้อัตโนมัติ ไม่ crash
function handleGpsDenied(target) {
  SheetManager.showGpsWarning(() => selectTarget(target));
  appState.user.isInsideCampus = true;
  runContextRouting(target, CAMPUS_CONSTANTS.DEFAULT_ORIGIN, { isFallbackOrigin: true });
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
