// liff/components/SheetManager.js
// ควบคุมการแสดงผล Bottom Action Sheet + Top Notice Bar (Module_2_Technical_Specification.md §4)
// เป็น pure UI layer — ไม่รู้เรื่อง Google Maps/Directions เลย รับแค่ข้อมูลที่ประกอบมาแล้วมาโชว์
//
// ใช้แบบ global script (ไม่มี build step ในโปรเจกต์นี้) — expose ผ่าน window.SheetManager

(function () {
  function sheetSlot() {
    return document.getElementById('action-sheet-slot');
  }
  function noticeSlot() {
    return document.getElementById('notice-bar-slot');
  }

  function hide() {
    const slot = sheetSlot();
    if (slot) slot.innerHTML = '';
    syncSheetHeight();
  }

  // ปุ่มควบคุมแผนที่อยู่มุมล่างขวา ต้องขยับหนีขึ้นเมื่อมีการ์ดโผล่มา ไม่งั้นโดนการ์ดทับ —
  // ความสูงการ์ดไม่คงที่ (บางแบบมีข้อความ บางแบบไม่มี) จึงวัดจริงแล้วส่งเป็น CSS variable ให้ CSS
  // เอาไปคำนวณเอง แทนการ hardcode ระยะไว้
  function syncSheetHeight() {
    const container = document.querySelector('.map-container');
    if (!container) return;
    const card = sheetSlot() && sheetSlot().firstElementChild;
    container.style.setProperty('--sheet-height', `${card ? card.offsetHeight : 0}px`);
  }

  // ใช้ตอน on-campus (WALKING/DRIVING ภายในแคมปัส) — มีระยะทาง/เวลาจาก RouteCalculator แล้ว
  // onClose มาจากผู้เรียก (app.js) เพราะการยกเลิกต้องล้าง state/เส้นทาง/หมุด ซึ่งอยู่นอก SheetManager
  let onCloseHandler = null;

  function bindClose() {
    const btn = document.getElementById('sheet-close-btn');
    if (btn && onCloseHandler) btn.addEventListener('click', onCloseHandler);
  }

  function setOnClose(handler) {
    onCloseHandler = handler;
  }

  function showRouteSheet({ title, distanceText, durationText, actionLabel, onAction }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <div class="sheet-handle"></div>
        <button class="sheet-close" id="sheet-close-btn" aria-label="ยกเลิกจุดหมาย">&times;</button>
        <h2>${title}</h2>
        <div class="nav-stats">
          <span><small>ระยะเวลา</small>${durationText}</span>
          <span><small>ระยะทาง</small>${distanceText}</span>
        </div>
        <button class="btn btn-primary" id="sheet-action-btn">${actionLabel}</button>
      </div>
    `;
    document.getElementById('sheet-action-btn').addEventListener('click', onAction);
    bindClose();
    syncSheetHeight();
  }

  // Scenario: อยู่นอก ม.รามฯ — ไม่คำนวณระยะเดิน/ขับข้ามเมือง ให้เปิด Google Maps ภายนอกแทน
  // ปลายทางคือ "ลานจอดที่ใกล้จุดหมายที่สุด" ไม่ใช่ประตูหน้า — บอกชื่อลานกับสถานะไปด้วยเลย
  // ผู้ใช้จะได้รู้ตั้งแต่ยังไม่ออกรถว่าจะไปจอดตรงไหนและตอนนี้เต็มหรือยัง
  function showOffCampusSheet({ title, parkingName, parkingStatus, onOpenGoogleMaps }) {
    const slot = sheetSlot();
    if (!slot) return;
    const destination = parkingName
      ? `<p class="muted">📍 คุณอยู่นอกพื้นที่ ม.รามฯ — จะนำทางไปที่ <strong>${parkingName}</strong>` +
        `${parkingStatus ? ` (ตอนนี้${parkingStatus})` : ''} ซึ่งเป็นลานจอดที่ใกล้จุดหมายที่สุด</p>`
      : '<p class="muted">📍 คุณอยู่นอกพื้นที่ ม.รามฯ แนะนำเดินทางด้วยรถยนต์หรือขนส่งสาธารณะมายังจุดนัดพบหลัก</p>';
    slot.innerHTML = `
      <div class="nav-info-card">
        <div class="sheet-handle"></div>
        <button class="sheet-close" id="sheet-close-btn" aria-label="ยกเลิกจุดหมาย">&times;</button>
        <h2>${title}</h2>
        ${destination}
        <button class="btn btn-primary" id="sheet-action-btn">นำทางด้วย Google Maps</button>
      </div>
    `;
    document.getElementById('sheet-action-btn').addEventListener('click', onOpenGoogleMaps);
    bindClose();
    syncSheetHeight();
  }

  // ใช้ตอนหาเส้นทางไม่ได้เลย (Directions API คืน error) — ตอบตรงๆ ไม่เดา ไม่วาดเส้นผิด
  function showRouteErrorSheet({ title, onFocus }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <div class="sheet-handle"></div>
        <button class="sheet-close" id="sheet-close-btn" aria-label="ยกเลิกจุดหมาย">&times;</button>
        <h2>${title}</h2>
        <p class="muted">ไม่พบเส้นทางสำหรับตำแหน่งนี้ครับ</p>
        <button class="btn btn-primary" id="sheet-action-btn">ไปที่ตำแหน่งอาคาร</button>
      </div>
    `;
    document.getElementById('sheet-action-btn').addEventListener('click', onFocus);
    bindClose();
    syncSheetHeight();
  }

  // การ์ดระหว่างนำทาง — ตัดปุ่ม "เริ่มเดินทาง" ออก เหลือระยะที่เหลือกับปุ่มจบการนำทาง
  // ไม่ใส่ปุ่มกากบาทเพราะการหยุดนำทางควรตั้งใจกด ไม่ใช่เผลอปัดโดนแล้วเส้นทางหาย
  function showNavigationSheet({ title, remainingText, etaText, onStop }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <div class="sheet-handle"></div>
        <h2>${title}</h2>
        <div class="nav-stats">
          <span><small>เหลืออีก</small>${remainingText}</span>
          <span><small>ถึงใน</small>${etaText}</span>
        </div>
        <button class="btn btn-ghost" id="sheet-stop-btn">จบการนำทาง</button>
      </div>
    `;
    document.getElementById('sheet-stop-btn').addEventListener('click', onStop);
    syncSheetHeight();
  }

  // อัปเดตแค่ตัวเลขระหว่างเดิน ไม่ต้องเขียน innerHTML ใหม่ทั้งการ์ด ไม่งั้นปุ่มจะถูกสร้างใหม่
  // ทุกครั้งที่ GPS ขยับ แล้ว event listener หลุด
  function updateNavigationStats(remainingText, etaText) {
    const stats = sheetSlot() && sheetSlot().querySelectorAll('.nav-stats span');
    if (!stats || stats.length < 2) return;
    stats[0].innerHTML = `<small>เหลืออีก</small>${remainingText}`;
    stats[1].innerHTML = `<small>ถึงใน</small>${etaText}`;
  }

  function showGpsWarning(onRetry) {
    const slot = noticeSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="notice-bar">
        <p>⚠️ เพื่อความแม่นยำในการนำทาง กรุณาเปิดใช้งานตำแหน่ง (GPS) บนอุปกรณ์ของคุณ</p>
        <button class="btn" id="gps-retry-btn">🔄 ลองอีกครั้ง</button>
      </div>
    `;
    document.getElementById('gps-retry-btn').addEventListener('click', onRetry);
  }

  function hideGpsWarning() {
    const slot = noticeSlot();
    if (slot) slot.innerHTML = '';
  }

  window.SheetManager = {
    hide,
    setOnClose,
    showRouteSheet,
    showNavigationSheet,
    updateNavigationStats,
    showOffCampusSheet,
    showRouteErrorSheet,
    showGpsWarning,
    hideGpsWarning,
  };
})();
