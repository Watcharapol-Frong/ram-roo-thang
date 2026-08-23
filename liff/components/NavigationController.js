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

  // ห่างจากเส้นทางเกินเท่านี้ = น่าจะเดินหลง — ตั้งกว้างกว่าความคลาดเคลื่อน GPS (5-15 ม.) พอสมควร
  // และต้องหลุดติดกันหลายครั้งถึงจะนับ กัน GPS แกว่งทีเดียวแล้วสั่งคำนวณเส้นทางใหม่ทั้งที่เดินถูกอยู่
  const OFF_ROUTE_RADIUS_M = 35;
  const OFF_ROUTE_CONFIRM_COUNT = 3;
  // เว้นช่วงก่อนยอมคำนวณใหม่อีกรอบ กันกรณีเส้นทางใหม่ก็ยังห่างอยู่แล้ววนขอซ้ำไม่หยุด
  const REROUTE_COOLDOWN_MS = 10000;

  // อ่านออกเสียงคำสั่งเลี้ยว — ใช้ Web Speech API ที่มีในเบราว์เซอร์อยู่แล้ว ไม่ต้องพึ่ง service ภายนอก
  // ไม่ใช่ทุกเครื่องจะมีเสียงไทย ถ้าไม่มีก็ปล่อยให้เครื่องเลือกเสียงเองแทนการเงียบไปเฉยๆ
  function speak(text, muted) {
    if (muted || !text || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'th-TH';
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error('พูดคำสั่งไม่สำเร็จ', err);
    }
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

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

  const MUTE_ICON = {
    on: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4zm12.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4z"/></svg>',
    off: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4zm15.7-1.3l-1.4-1.4L16 8.6l-2.3-2.3v2.8l.9.9 5.1 5.1 1.4-1.4-2.3-2.3 1-1z"/></svg>',
  };

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
    checkOffRoute(location, nearestDistance);
  }

  function checkOffRoute(location, distanceToRoute) {
    if (distanceToRoute > OFF_ROUTE_RADIUS_M) session.offRouteCount += 1;
    else session.offRouteCount = 0;

    if (session.offRouteCount < OFF_ROUTE_CONFIRM_COUNT) return;
    if (Date.now() - session.lastRerouteAt < REROUTE_COOLDOWN_MS) return;

    session.offRouteCount = 0;
    session.lastRerouteAt = Date.now();
    speak('กำลังคำนวณเส้นทางใหม่', session.muted);
    session.onOffRoute(location);
  }

  // เส้นทางใหม่หลังเดินหลง — เก็บ session เดิมไว้ (watch ยังทำงานอยู่) เปลี่ยนแค่เส้นทางกับความคืบหน้า
  function updateRoute(route) {
    if (!session) return;
    session.steps = route.steps || [];
    session.path = route.path && route.path.length > 1 ? route.path : [];
    session.cumulative = buildCumulative(session.path);
    session.stepEnds = buildStepEnds(session.steps);
    session.totalMeters = route.distanceMeters || 0;
    session.progressMeters = 0;
    session.stepIndex = 0;
    session.spokenStepIndex = -1;
    session.arrived = false;
    render(null);
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
      // ระยะทางที่ Google บอก (leg.distance) ต่างจากความยาว overview_path เล็กน้อยเพราะ path ถูกลดจุด
      // ยึดตัวเลขของ Google เป็นหลักแล้วเทียบสัดส่วนเอา ไม่งั้นการ์ดโชว์ 530 m แล้วพอเริ่มเดิน
      // ตัวเลขกระโดดขึ้นเป็น 537 m ทั้งที่เพิ่งออกเดิน
      totalMeters: config.totalMeters || 0,
      // ระยะสะสม ณ จุดจบของแต่ละขั้นตอน ใช้ตัดสินว่าตอนนี้อยู่ขั้นไหน
      stepEnds: buildStepEnds(config.steps || []),
      progressMeters: 0,
      stepIndex: 0,
      spokenStepIndex: -1,
      muted: false,
      offRouteCount: 0,
      lastRerouteAt: 0,
      destinationName: config.destinationName || '',
      onPosition: config.onPosition || (() => {}),
      onArrive: config.onArrive || (() => {}),
      onOffRoute: config.onOffRoute || (() => {}),
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
    stopSpeaking();
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
      speak(`ถึง${session.destinationName}แล้ว`, session.muted);
      render(location);
      session.onArrive();
      return;
    }

    // พูดเฉพาะตอนเปลี่ยนขั้นตอน ไม่ใช่ทุกครั้งที่ GPS ขยับ ไม่งั้นจะพูดซ้ำทุกวินาที
    if (session.stepIndex !== session.spokenStepIndex) {
      session.spokenStepIndex = session.stepIndex;
      const step = session.steps[session.stepIndex];
      if (step) speak(step.instruction, session.muted);
    }
    render(location);
  }

  function remainingMeters() {
    if (!session) return 0;
    const pathLength = routeLength();
    if (!pathLength) return 0;
    const ratio = 1 - session.progressMeters / pathLength;
    const total = session.totalMeters || pathLength;
    return Math.max(0, total * ratio);
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
        <button class="nav-mute-btn" id="nav-mute-btn" aria-label="${session.muted ? 'เปิดเสียง' : 'ปิดเสียง'}">
          ${session.muted ? MUTE_ICON.off : MUTE_ICON.on}
        </button>
      </div>
    `;
    const muteBtn = document.getElementById('nav-mute-btn');
    if (muteBtn) muteBtn.addEventListener('click', toggleMute);
  }

  function toggleMute() {
    if (!session) return;
    session.muted = !session.muted;
    if (session.muted) stopSpeaking();
    render(null);
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

  window.NavigationController = { start, stop, isActive, status, updateRoute };
})();
