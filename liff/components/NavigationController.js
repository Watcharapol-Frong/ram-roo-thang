// liff/components/NavigationController.js
// โหมดนำทาง — ตามตำแหน่งผู้ใช้แบบสด แล้วบอกว่าตอนนี้ต้องเลี้ยวไปทางไหน
//
// ระยะในแคมปัสสั้น (ราว 100-700 ม.) ที่ผู้ใช้ต้องการจริงๆ คือ "เดินไปทางไหน" กับ "ยังเดินถูกอยู่ไหม"
// จึงไม่ทำเสียงหรือ re-route อัตโนมัติ เอาแค่ขั้นตอนถัดไป + ระยะที่เหลือ + กล้องตามตัว
//
// ใช้แบบ global script (ไม่มี build step ในโปรเจกต์นี้) — expose ผ่าน window.NavigationController

(function () {
  // ถือว่าถึงจุดหมายเมื่อเข้าใกล้ปลายทางเท่านี้ — GPS มือถือกลางแจ้งคลาดเคลื่อนราว 5-15 ม.
  const ARRIVED_RADIUS_M = 25;
  const WALKING_SPEED_M_PER_MIN = 75;

  // ลูกศรบอกทิศเลี้ยว — Google ส่ง maneuver มาหลายแบบมาก ยุบเหลือ 4 ทิศพอ ที่เหลือถือเป็นตรงไป
  const MANEUVER_ICON = {
    left: '<path d="M12 4l-7 7 7 7v-4.5h7v-5h-7V4z"/>',
    right: '<path d="M12 4v4.5H5v5h7V18l7-7-7-7z"/>',
    straight: '<path d="M12 3l6 7h-4v11h-4V10H6l6-7z"/>',
    uturn: '<path d="M9 21V10a3 3 0 116 0v3h-3l4 5 4-5h-3v-3a6 6 0 10-12 0v11h4z"/>',
  };

  function maneuverKey(maneuver) {
    if (!maneuver) return 'straight';
    if (maneuver.includes('uturn')) return 'uturn';
    if (maneuver.includes('left')) return 'left';
    if (maneuver.includes('right')) return 'right';
    return 'straight';
  }

  let session = null;

  function instructionSlot() {
    return document.getElementById('nav-instruction-slot');
  }

  function distanceBetween(a, b) {
    return google.maps.geometry.spherical.computeDistanceBetween(
      new google.maps.LatLng(a.lat, a.lng),
      new google.maps.LatLng(b.lat, b.lng)
    );
  }

  function formatMeters(meters) {
    return `${Math.max(0, Math.round(meters))} m`;
  }

  function isActive() {
    return session !== null;
  }

  function buildCumulative(path) {
    const cumulative = [0];
    for (let i = 1; i < path.length; i += 1) {
      cumulative.push(cumulative[i - 1] + distanceBetween(path[i - 1], path[i]));
    }
    return cumulative;
  }

  function buildStepEnds(steps) {
    let total = 0;
    return steps.map((step) => {
      total += step.distanceMeters;
      return total;
    });
  }

  function routeLength() {
    const { cumulative } = session;
    return cumulative.length ? cumulative[cumulative.length - 1] : 0;
  }

  // วัดความคืบหน้าจาก "จุดบนเส้นทางที่ใกล้ตัวเราที่สุด" ไม่ใช่จากระยะถึงปลายขั้นตอนปัจจุบัน
  // วิธีเดิมพังเมื่อเดินเลยจุดเลี้ยวไปโดยไม่ได้เฉียดใกล้พอ (GPS ส่งค่าเป็นช่วงๆ ข้ามได้ทีละสิบเมตร)
  // แล้ว stepIndex ค้างอยู่ขั้นเก่า ระยะถึงปลายขั้นนั้นก็ยิ่งไกลขึ้นเรื่อยๆ จนระยะที่เหลือมากกว่า
  // ระยะทางทั้งเส้น — ส่วนวิธีนี้ยังไงก็อยู่ในช่วง 0 ถึงความยาวเส้นทางเสมอ
  function updateProgress(location) {
    const { path, cumulative } = session;
    if (!path.length) return;
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let i = 0; i < path.length; i += 1) {
      const d = distanceBetween(location, path[i]);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearestIndex = i;
      }
    }
    // เดินหน้าอย่างเดียว กัน GPS แกว่งจนตัวเลข "เหลืออีก" เด้งกลับไปกลับมา
    session.progressMeters = Math.max(session.progressMeters, cumulative[nearestIndex]);
    session.stepIndex = stepIndexAt(session.progressMeters);
  }

  function stepIndexAt(progress) {
    const { stepEnds } = session;
    for (let i = 0; i < stepEnds.length; i += 1) {
      if (progress < stepEnds[i] - 1) return i;
    }
    return Math.max(0, stepEnds.length - 1);
  }

  // config: { steps, destinationName, watch, onPosition, onArrive, onStop }
  // watch(cb) ต้องคืนฟังก์ชันสำหรับยกเลิกการติดตาม — ผู้เรียกเป็นคนตัดสินใจว่าจะใช้ GPS จริง
  // หรือจำลอง (ดู DEV_MODE ใน app.js) NavigationController ไม่ต้องรู้
  function start(config) {
    stop();
    const path = config.path && config.path.length > 1 ? config.path : [];
    session = {
      steps: config.steps || [],
      path,
      // ระยะสะสมของแต่ละจุดบนเส้นทาง ใช้วัดว่าเดินมาแล้วกี่เมตร แทนการเดาจากระยะถึงปลายขั้นตอน
      cumulative: buildCumulative(path),
      // ระยะสะสม ณ จุดจบของแต่ละขั้นตอน ใช้ตัดสินว่าตอนนี้อยู่ขั้นไหน
      stepEnds: buildStepEnds(config.steps || []),
      progressMeters: 0,
      stepIndex: 0,
      destinationName: config.destinationName || '',
      onPosition: config.onPosition || (() => {}),
      onArrive: config.onArrive || (() => {}),
      onStop: config.onStop || (() => {}),
      cancelWatch: null,
      arrived: false,
    };
    document.body.classList.add('is-navigating');
    render(null);
    session.cancelWatch = config.watch((location) => handlePosition(location));
  }

  function stop() {
    if (!session) return;
    const { cancelWatch, onStop } = session;
    session = null;
    if (cancelWatch) cancelWatch();
    document.body.classList.remove('is-navigating');
    const slot = instructionSlot();
    if (slot) slot.innerHTML = '';
    onStop();
  }

  function handlePosition(location) {
    if (!session) return;
    session.onPosition(location);

    updateProgress(location);

    const last = session.steps[session.steps.length - 1];
    if (last && !session.arrived && distanceBetween(location, last.endLocation) < ARRIVED_RADIUS_M) {
      session.arrived = true;
      render(location);
      session.onArrive();
      return;
    }
    render(location);
  }

  function remainingMeters() {
    if (!session) return 0;
    return Math.max(0, routeLength() - session.progressMeters);
  }

  function render(location) {
    const slot = instructionSlot();
    if (!slot || !session) return;

    if (session.arrived) {
      slot.innerHTML = `
        <div class="nav-instruction nav-instruction-arrived">
          <div class="nav-instruction-text">
            <strong>ถึงจุดหมายแล้ว</strong>
            <small>${session.destinationName}</small>
          </div>
        </div>
      `;
      return;
    }

    const step = session.steps[session.stepIndex];
    if (!step) return;
    const toTurn = Math.max(0, session.stepEnds[session.stepIndex] - session.progressMeters);

    slot.innerHTML = `
      <div class="nav-instruction">
        <svg class="nav-maneuver" viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
          ${MANEUVER_ICON[maneuverKey(step.maneuver)]}
        </svg>
        <div class="nav-instruction-text">
          <strong>${step.instruction}</strong>
          <small>อีก ${formatMeters(toTurn)}</small>
        </div>
      </div>
    `;
  }

  function status() {
    if (!session) return null;
    const meters = remainingMeters();
    return {
      arrived: session.arrived,
      remainingMeters: meters,
      remainingMinutes: Math.max(1, Math.ceil(meters / WALKING_SPEED_M_PER_MIN)),
      stepIndex: session.stepIndex,
      totalSteps: session.steps.length,
    };
  }

  window.NavigationController = { start, stop, isActive, status };
})();
