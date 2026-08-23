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

  function init(map) {
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
      map,
      suppressMarkers: true,
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
        },
        (result, status) => {
          if (status !== 'OK' || !result.routes[0]) {
            reject(new Error(`หาเส้นทางไม่สำเร็จ (${status})`));
            return;
          }
          directionsRenderer.setDirections(result);
          const leg = result.routes[0].legs[0];
          drawConnectors(origin, destination, leg);
          resolve({
            distanceMeters: leg.distance.value,
            distanceText: leg.distance.text,
            durationMinutes: Math.ceil(leg.duration.value / 60),
            durationText: leg.duration.text,
          });
        }
      );
    });
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

  function clearRoute() {
    if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
    clearConnectors();
  }

  window.RouteCalculator = { init, calculateRoute, clearRoute };
})();
