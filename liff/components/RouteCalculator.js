// liff/components/RouteCalculator.js
// คำนวณเส้นทางผ่าน Google Directions API (Module_2_Technical_Specification.md §4) — แทนที่
// A* router เดิม (Google มีข้อมูลถนน/ทางเดินจริงของตัวเองอยู่แล้ว ไม่ต้องดูแล walkway graph เอง)
//
// ใช้แบบ global script (ไม่มี build step ในโปรเจกต์นี้) — expose ผ่าน window.RouteCalculator

(function () {
  let directionsService = null;
  let directionsRenderer = null;
  // Directions API เกาะเส้นทางไปที่ "ถนนที่ใกล้ที่สุด" ปลายเส้นจึงไม่ตรงกับหมุดจุดหมาย/ตำแหน่ง
  // ผู้ใช้เป๊ะๆ เหลือช่องว่างค้างไว้ดูเหมือนเส้นขาด — ลากเส้นประเชื่อมช่วงที่ขาดให้เอง
  let connectorLines = [];
  // เก็บผลลัพธ์ล่าสุดไว้วาดซ้ำตอนสลับ 2D/3D — การสลับต้องสร้าง map ใหม่ ถ้าไปเรียก Directions API
  // ใหม่ทุกครั้งจะหน่วงเห็นได้ชัด (รอเน็ต) และเปลืองโควตาโดยไม่จำเป็น เพราะเส้นทางไม่ได้เปลี่ยน
  let lastRender = null;

  function init(map) {
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
      map,
      suppressMarkers: true,
      // ค่าเริ่มต้นของ DirectionsRenderer คือจัดกล้องให้เห็นเส้นทางทั้งเส้นทุกครั้งที่ setDirections
      // ซึ่งไปทับ zoom/มุมกล้องที่เราตั้งไว้ — เลือกอาคารตอนอยู่โหมด 3D แล้วเด้งกลับเป็นมุม 2D
      // เพราะเหตุนี้ กล้องเป็นเรื่องของ applyViewMode ฝั่งเดียว renderer แค่วาดเส้นพอ
      preserveViewport: true,
      polylineOptions: { strokeColor: '#1560ff', strokeWeight: 5 },
    });
  }

  // origin/destination: {lat, lng}, travelMode: 'WALKING' | 'DRIVING'
  // คืนค่า { distanceMeters, distanceText, durationMinutes, durationText } หรือ throw ถ้าหาเส้นทางไม่ได้
  function calculateRoute(origin, destination, travelMode) {
    return new Promise((resolve, reject) => {
      if (!directionsService) {
        reject(new Error('RouteCalculator ยังไม่ได้ init'));
        return;
      }
      directionsService.route(
        {
          origin,
          destination,
          travelMode: google.maps.TravelMode[travelMode],
          // ขอคำสั่งเลี้ยวเป็นภาษาไทยจาก Google เลย ("เลี้ยวขวา", "ปลายทางจะอยู่ทางขวา")
          // จะได้ไม่ต้องแปล maneuver เองแล้วเสี่ยงแปลผิด
          language: 'th',
        },
        (result, status) => {
          if (status !== 'OK' || !result.routes[0]) {
            reject(new Error(`หาเส้นทางไม่สำเร็จ (${status})`));
            return;
          }
          directionsRenderer.setDirections(result);
          const leg = result.routes[0].legs[0];
          drawConnectors(origin, destination, leg);
          lastRender = { result, origin, destination, leg };
          resolve({
            distanceMeters: leg.distance.value,
            distanceText: leg.distance.text,
            durationMinutes: Math.ceil(leg.duration.value / 60),
            durationText: leg.duration.text,
            // ข้อมูลสำหรับโหมดนำทาง — ขั้นตอนย่อยพร้อมจุดจบของแต่ละขั้น ใช้เช็คว่าเดินถึงขั้นไหนแล้ว
            steps: leg.steps.map((step) => ({
              instruction: stripHtml(step.instructions),
              distanceMeters: step.distance.value,
              endLocation: { lat: step.end_location.lat(), lng: step.end_location.lng() },
              maneuver: step.maneuver || '',
            })),
            path: result.routes[0].overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() })),
          });
        }
      );
    });
  }

  // instructions มาเป็น HTML (มี <b>, <div> คั่นคำสั่งย่อย) แทนแท็กด้วยช่องว่างแทนการลบทิ้ง
  // ไม่งั้นคำสั่งสองท่อนจะติดกันเป็น "เลี้ยวขวาปลายทางจะอยู่ทางขวา"
  function stripHtml(html) {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // เส้นประจากจุดเริ่ม/จุดจบจริง ไปหาปลายเส้นทางที่ Google เกาะถนนไว้ — วาดเฉพาะตอนห่างเกิน 3 ม.
  // จะได้ไม่มีขีดจิ๋วๆ โผล่มาเกะกะตอนที่ปลายเส้นมันตรงกันอยู่แล้ว
  const CONNECTOR_MIN_GAP_METERS = 3;

  function drawConnectors(origin, destination, leg) {
    clearConnectors();
    const pairs = [
      [origin, leg.start_location],
      [destination, leg.end_location],
    ];
    pairs.forEach(([point, snapped]) => {
      const from = new google.maps.LatLng(point.lat, point.lng);
      if (google.maps.geometry.spherical.computeDistanceBetween(from, snapped) < CONNECTOR_MIN_GAP_METERS) return;
      connectorLines.push(new google.maps.Polyline({
        map: directionsRenderer.getMap(),
        path: [from, snapped],
        strokeOpacity: 0,
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: '#1560ff', strokeWeight: 4, scale: 3 },
          offset: '0',
          repeat: '12px',
        }],
      }));
    });
  }

  function clearConnectors() {
    connectorLines.forEach((line) => line.setMap(null));
    connectorLines = [];
  }

  // วาดเส้นทางเดิมซ้ำบนแผนที่ปัจจุบัน (เรียกหลัง init กับ map ตัวใหม่) ไม่ยิง API ใหม่
  function redraw() {
    if (!lastRender || !directionsRenderer) return false;
    directionsRenderer.setDirections(lastRender.result);
    drawConnectors(lastRender.origin, lastRender.destination, lastRender.leg);
    return true;
  }

  function clearRoute() {
    if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
    clearConnectors();
    lastRender = null;
  }

  window.RouteCalculator = { init, calculateRoute, clearRoute, redraw };
})();
