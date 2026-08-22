// liff/components/RouteCalculator.js
// คำนวณเส้นทางผ่าน Google Directions API (Module_2_Technical_Specification.md §4) — แทนที่
// A* router เดิม (Google มีข้อมูลถนน/ทางเดินจริงของตัวเองอยู่แล้ว ไม่ต้องดูแล walkway graph เอง)
//
// ใช้แบบ global script (ไม่มี build step ในโปรเจกต์นี้) — expose ผ่าน window.RouteCalculator

(function () {
  let directionsService = null;
  let directionsRenderer = null;

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

  function clearRoute() {
    if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
  }

  window.RouteCalculator = { init, calculateRoute, clearRoute };
})();
